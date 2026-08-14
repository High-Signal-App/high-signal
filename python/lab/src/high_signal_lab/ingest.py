"""HN ingest: pull top stories + comments into the Lab Postgres index."""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime
from urllib.parse import urlparse

import httpx
import trafilatura
from lxml import html as lxml_html
from tenacity import retry, stop_after_attempt, wait_exponential

from .db import connect

HN_BASE = "https://hacker-news.firebaseio.com/v0"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fetch_json(client: httpx.Client, url: str) -> dict:
    response = client.get(url, timeout=20.0)
    response.raise_for_status()
    return response.json()


def fetch_top_story_ids(client: httpx.Client, limit: int) -> list[int]:
    ids = _fetch_json(client, f"{HN_BASE}/topstories.json")
    return ids[:limit]


def fetch_item(client: httpx.Client, item_id: int) -> dict | None:
    try:
        return _fetch_json(client, f"{HN_BASE}/item/{item_id}.json")
    except Exception:
        return None


def extract_text(url: str) -> str | None:
    try:
        downloaded = trafilatura.fetch_url(url, no_ssl=True)
        if not downloaded:
            return None
        return trafilatura.extract(downloaded, include_comments=False) or None
    except Exception:
        return None


# Domains we never want to treat as one-hop link discoveries: pure navigation,
# share buttons, accounts, search, generic boilerplate.
_NOISE_HOSTS = {
    "twitter.com",
    "x.com",
    "facebook.com",
    "linkedin.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "pinterest.com",
    "t.me",
    "mailto:",
    "javascript:",
}


def extract_links(url: str, max_links: int = 10) -> tuple[str | None, list[str]]:
    """Return (extracted_text, outbound_links).

    Outbound links are http(s), de-duped by URL, capped, and exclude same-host
    and common social/navigation noise. Caller decides what to do with them.
    """
    try:
        downloaded = trafilatura.fetch_url(url, no_ssl=True)
        if not downloaded:
            return None, []
        text = trafilatura.extract(downloaded, include_comments=False) or None
    except Exception:
        return None, []

    links: list[str] = []
    try:
        tree = lxml_html.fromstring(downloaded)
        own_host = urlparse(url).hostname or ""
        seen: set[str] = set()
        for href in tree.xpath("//a/@href"):  # type: ignore[union-attr]
            if not isinstance(href, str):
                continue
            href = href.strip()
            if not href.startswith(("http://", "https://")):
                continue
            host = urlparse(href).hostname or ""
            if host == own_host:
                continue
            if any(host.endswith(noise) for noise in _NOISE_HOSTS if "." in noise):
                continue
            normalized = href.split("#")[0]
            if normalized in seen:
                continue
            seen.add(normalized)
            links.append(normalized)
            if len(links) >= max_links:
                break
    except Exception:
        pass
    return text, links


def domain_of(url: str) -> str | None:
    try:
        return urlparse(url).hostname
    except Exception:
        return None


def upsert_document(
    conn,
    *,
    url: str,
    source: str,
    title: str,
    text: str | None,
    published_at: datetime | None,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO documents (url, canonical_url, source, domain, title, extracted_text,
                                   short_summary, published_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (url) DO UPDATE
              SET title = EXCLUDED.title,
                  extracted_text = COALESCE(EXCLUDED.extracted_text, documents.extracted_text),
                  short_summary = COALESCE(EXCLUDED.short_summary, documents.short_summary),
                  published_at = COALESCE(documents.published_at, EXCLUDED.published_at)
            RETURNING id
            """,
            (
                url,
                url,
                source,
                domain_of(url),
                title,
                text,
                (text or "")[:280] or None,
                published_at,
            ),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def upsert_hn_thread(
    conn,
    *,
    hn_id: int,
    document_id: int,
    score: int,
    comment_count: int,
    posted_at: datetime,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO hn_threads (hn_id, document_id, score, comment_count, posted_at,
                                    last_polled_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (hn_id) DO UPDATE
              SET score = EXCLUDED.score,
                  comment_count = EXCLUDED.comment_count,
                  document_id = EXCLUDED.document_id,
                  last_polled_at = now()
            """,
            (hn_id, document_id, score, comment_count, posted_at),
        )


def record_link(
    conn,
    *,
    from_document_id: int,
    to_url: str,
    link_type: str,
    to_document_id: int | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO links (from_document_id, to_url, to_document_id, link_type)
            VALUES (%s, %s, %s, %s)
            """,
            (from_document_id, to_url, to_document_id, link_type),
        )


def ingest_hn(limit: int = 30, extract_pages: bool = True) -> tuple[int, int]:
    """Ingest the top HN stories. Returns (inserted_or_updated, errors)."""
    inserted = 0
    errors = 0
    with (
        httpx.Client(headers={"User-Agent": "HighSignal-Lab/0.1"}) as client,
        connect() as conn,
    ):
        ids = fetch_top_story_ids(client, limit)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ingest_runs (source, started_at) VALUES ('hn', now()) RETURNING id"
            )
            run_id = int(cur.fetchone()[0])
        for hn_id in ids:
            item = fetch_item(client, hn_id)
            if not item or item.get("deleted") or item.get("dead"):
                continue
            title = item.get("title") or f"HN item {hn_id}"
            posted_at = datetime.fromtimestamp(item.get("time", 0), UTC)
            score = int(item.get("score") or 0)
            comments = int(item.get("descendants") or 0)
            hn_url = f"https://news.ycombinator.com/item?id={hn_id}"
            submitted_url = item.get("url") or hn_url

            try:
                hn_doc_id = upsert_document(
                    conn,
                    url=hn_url,
                    source="hn",
                    title=title,
                    text=item.get("text"),
                    published_at=posted_at,
                )
                upsert_hn_thread(
                    conn,
                    hn_id=hn_id,
                    document_id=hn_doc_id,
                    score=score,
                    comment_count=comments,
                    posted_at=posted_at,
                )

                if submitted_url and submitted_url != hn_url:
                    if extract_pages:
                        text, outbound = extract_links(submitted_url)
                    else:
                        text, outbound = None, []
                    submitted_doc_id = upsert_document(
                        conn,
                        url=submitted_url,
                        source="hn-linked",
                        title=title,
                        text=text,
                        published_at=posted_at,
                    )
                    record_link(
                        conn,
                        from_document_id=hn_doc_id,
                        to_url=submitted_url,
                        link_type="submitted",
                        to_document_id=submitted_doc_id,
                    )
                    for outbound_url in outbound:
                        # Lazy stub: record the link without materializing the
                        # linked document. A later pass can pick these up and
                        # upsert them into documents when worth fetching.
                        record_link(
                            conn,
                            from_document_id=submitted_doc_id,
                            to_url=outbound_url,
                            link_type="mentions",
                            to_document_id=None,
                        )
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE hn_threads SET document_id = %s WHERE hn_id = %s",
                            (submitted_doc_id, hn_id),
                        )
                inserted += 1
            except Exception as exc:
                errors += 1
                print(f"[hn] error on {hn_id}: {exc}", file=sys.stderr)
            time.sleep(0.05)  # gentle on HN firebase

        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ingest_runs SET finished_at = now(), inserted = %s, errors = %s
                WHERE id = %s
                """,
                (inserted, errors, run_id),
            )
    return inserted, errors


def main() -> None:
    parser = argparse.ArgumentParser(description="HighSignal Lab HN ingest")
    parser.add_argument("--limit", type=int, default=30, help="Top N stories to ingest")
    parser.add_argument(
        "--no-extract",
        action="store_true",
        help="Skip fetching the submitted URL bodies (fast metadata-only mode)",
    )
    args = parser.parse_args()
    inserted, errors = ingest_hn(limit=args.limit, extract_pages=not args.no_extract)
    print(f"hn ingest: {inserted} items, {errors} errors")


if __name__ == "__main__":
    main()
