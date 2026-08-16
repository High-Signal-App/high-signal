"""One-hop link materialization.

Plan 0007 step 4 completion: pick up `links` rows where `to_document_id IS NULL`,
fetch each URL, extract readable text, upsert as a document, and patch the link.

Idempotent: a link is only fetched once per run. Bounded by `--limit`.
"""

from __future__ import annotations

import argparse
import sys
import time
from urllib.parse import urlparse

from .db import connect
from .ingest import extract_text, upsert_document


def candidate_links(limit: int) -> list[tuple[int, str]]:
    """Return distinct (link_id, to_url) candidates ordered by recent first."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, to_url
            FROM links
            WHERE to_document_id IS NULL
              AND link_type IN ('mentions', 'discusses')
            ORDER BY discovered_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        return [(int(row[0]), row[1]) for row in cur.fetchall() or []]


def _domain(url: str) -> str:
    try:
        return urlparse(url).hostname or "unknown"
    except Exception:
        return "unknown"


def materialize(limit: int = 50, sleep_seconds: float = 0.25) -> tuple[int, int]:
    fetched = 0
    errors = 0
    candidates = candidate_links(limit)
    if not candidates:
        print("materialize: nothing to do (no NULL-targeted links)")
        return 0, 0

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ingest_runs (source, started_at) VALUES ('materialize', now()) "
                "RETURNING id"
            )
            run_id = int(cur.fetchone()[0])
        for link_id, to_url in candidates:
            try:
                text = extract_text(to_url)
                title = to_url.split("/")[-1] or _domain(to_url)
                doc_id = upsert_document(
                    conn,
                    url=to_url,
                    source="one-hop",
                    title=title,
                    text=text,
                    published_at=None,
                )
                with conn.cursor() as cur:
                    # Patch the originating link plus any other links pointing at the
                    # same URL (de-dupes across rows).
                    cur.execute(
                        """
                        UPDATE links
                           SET to_document_id = %s
                         WHERE to_url = %s AND to_document_id IS NULL
                        """,
                        (doc_id, to_url),
                    )
                fetched += 1
            except Exception as exc:
                errors += 1
                print(f"[materialize] {to_url}: {exc}", file=sys.stderr)
            time.sleep(sleep_seconds)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ingest_runs SET finished_at = now(), inserted = %s, errors = %s
                WHERE id = %s
                """,
                (fetched, errors, run_id),
            )
    return fetched, errors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HighSignal Lab one-hop materialization"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Max NULL-targeted links to fetch this run.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.25,
        help="Seconds to sleep between fetches (be polite).",
    )
    args = parser.parse_args()
    fetched, errors = materialize(limit=args.limit, sleep_seconds=args.sleep)
    print(f"materialize: {fetched} documents materialized, {errors} errors")


if __name__ == "__main__":
    main()
