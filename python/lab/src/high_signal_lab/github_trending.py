"""GitHub trending ingest — scrapes github.com/trending HTML (no API key).

Plan 0007 step 2 cheap path before the 14k-repo DB import + GitHub API
enrichment land. Idempotent: rerun upserts on `repos.full_name`.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import UTC, datetime

import httpx
from lxml import html as lxml_html

from .db import connect

TRENDING_URL = "https://github.com/trending"
USER_AGENT = "HighSignal-Lab/0.1 (+https://github.com/anthropics)"

# Languages worth tracking for the AI-infra wedge; empty -> all languages.
DEFAULT_LANGUAGES: list[str] = ["", "python", "rust", "typescript", "go"]
PERIODS: tuple[str, ...] = ("daily", "weekly", "monthly")

_STAR_RE = re.compile(r"\d[\d,]*")


def _int(value: str | None) -> int:
    if not value:
        return 0
    match = _STAR_RE.search(value)
    return int(match.group(0).replace(",", "")) if match else 0


def fetch_trending(language: str = "", since: str = "daily") -> list[dict]:
    params: dict[str, str] = {"since": since}
    url = TRENDING_URL + (f"/{language}" if language else "")
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30.0) as client:
        response = client.get(url, params=params)
        response.raise_for_status()
        tree = lxml_html.fromstring(response.text)

    rows: list[dict] = []
    for article in tree.cssselect("article.Box-row"):
        repo_link = article.cssselect("h2 a")
        if not repo_link:
            continue
        href = (repo_link[0].get("href") or "").strip()
        full_name = href.lstrip("/")
        if not full_name or full_name.count("/") != 1:
            continue
        description_el = article.cssselect("p")
        description = description_el[0].text_content().strip() if description_el else ""
        lang_el = article.cssselect("[itemprop='programmingLanguage']")
        repo_language = lang_el[0].text_content().strip() if lang_el else None
        star_els = article.cssselect("a.Link--muted")
        stars = _int(star_els[0].text_content()) if len(star_els) >= 1 else 0
        forks = _int(star_els[1].text_content()) if len(star_els) >= 2 else 0
        rows.append(
            {
                "full_name": full_name,
                "url": f"https://github.com/{full_name}",
                "description": description or None,
                "language": repo_language,
                "stars": stars,
                "forks": forks,
            }
        )
    return rows


def upsert_repo(
    conn,
    *,
    full_name: str,
    url: str,
    description: str | None,
    language: str | None,
    stars: int,
    forks: int,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO repos (full_name, url, description, language, stars, forks,
                               discovered_at)
            VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (full_name) DO UPDATE
              SET url = EXCLUDED.url,
                  description = COALESCE(EXCLUDED.description, repos.description),
                  language = COALESCE(EXCLUDED.language, repos.language),
                  stars = GREATEST(repos.stars, EXCLUDED.stars),
                  forks = GREATEST(repos.forks, EXCLUDED.forks)
            RETURNING id
            """,
            (full_name, url, description, language, stars, forks),
        )
        return int(cur.fetchone()[0])


def ingest_trending(languages: list[str], periods: tuple[str, ...]) -> tuple[int, int]:
    inserted = 0
    errors = 0
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ingest_runs (source, started_at) VALUES ('github-trending', now()) "
                "RETURNING id"
            )
            run_id = int(cur.fetchone()[0])
        for language in languages:
            for period in periods:
                try:
                    rows = fetch_trending(language=language, since=period)
                except Exception as exc:
                    errors += 1
                    print(
                        f"[gh-trending] error {language}/{period}: {exc}",
                        file=sys.stderr,
                    )
                    continue
                for row in rows:
                    try:
                        upsert_repo(conn, **row)
                        inserted += 1
                    except Exception as exc:
                        errors += 1
                        print(
                            f"[gh-trending] upsert error {row['full_name']}: {exc}",
                            file=sys.stderr,
                        )
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ingest_runs SET finished_at = now(), inserted = %s, errors = %s,
                                       notes = %s
                WHERE id = %s
                """,
                (
                    inserted,
                    errors,
                    f"languages={languages} periods={list(periods)}",
                    run_id,
                ),
            )
    return inserted, errors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HighSignal Lab GitHub trending ingest"
    )
    parser.add_argument(
        "--language",
        action="append",
        default=None,
        help="Filter language(s); repeatable. Empty/no flag uses defaults.",
    )
    parser.add_argument(
        "--period",
        action="append",
        choices=PERIODS,
        default=None,
        help="Trending window(s); repeatable.",
    )
    args = parser.parse_args()
    languages = args.language if args.language else DEFAULT_LANGUAGES
    periods = tuple(args.period) if args.period else PERIODS
    inserted, errors = ingest_trending(languages, periods)
    print(
        f"gh-trending: {inserted} rows upserted, {errors} errors "
        f"(now={datetime.now(UTC).isoformat()})"
    )


if __name__ == "__main__":
    main()
