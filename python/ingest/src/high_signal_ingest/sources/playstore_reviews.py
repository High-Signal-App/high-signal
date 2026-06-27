"""Google Play customer-reviews adapter (free, key-less library).

Android counterpart to `appstore_reviews` — product-perception + idea-mining
from Play Store reviews. Uses the `google-play-scraper` library (free, no key,
hits Google's JSON endpoint — not browser scraping, not Cloudflare-blocked).
The library is **lazy-imported**, so if it isn't installed the source simply
yields nothing rather than breaking ingest.

Seed brands via `PLAYSTORE_REVIEW_APPS` (`Name:package.name,...`); defaults to a
curated set. Package names are seeded directly because Play's search returns a
null id for many official apps. Point it at a connected brand's package for §4.

Output: Events tagged `source: playstore-reviews`.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from ..types import Event
from ..utils import event_hash

LOGGER = logging.getLogger(__name__)
# (display name, android package)
DEFAULT_APPS: tuple[tuple[str, str], ...] = (
    ("ChatGPT", "com.openai.chatgpt"),
    ("Perplexity", "ai.perplexity.app.android"),
    ("Notion", "notion.id"),
    ("Coinbase", "com.coinbase.android"),
    ("Robinhood", "com.robinhood.android"),
    ("Duolingo", "com.duolingo"),
)
PER_APP = 30


def _apps_from_env() -> list[tuple[str, str]]:
    raw = os.environ.get("PLAYSTORE_REVIEW_APPS", "").strip()
    if not raw:
        return list(DEFAULT_APPS)
    out: list[tuple[str, str]] = []
    for chunk in raw.split(","):
        name, _, pkg = chunk.strip().partition(":")
        if name.strip() and pkg.strip():
            out.append((name.strip(), pkg.strip()))
    return out or list(DEFAULT_APPS)


def reviews_to_events(app: str, rows: list[dict], since: datetime) -> list[Event]:
    out: list[Event] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("reviewId") or "")
        content = str(r.get("content") or "").strip()
        score = r.get("score")
        at = r.get("at")
        if not rid or not content or not isinstance(at, datetime):
            continue
        published = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at.astimezone(timezone.utc)
        if published < since:
            continue
        raw_hash = event_hash("playstore-reviews", rid)
        out.append(
            Event(
                id=raw_hash[:16],
                source="playstore-reviews",
                # reviewId makes it distinct per review (else dedup collapses an
                # app's reviews, which share the app URL).
                source_url=f"https://play.google.com/store/apps/details?id={r.get('_appId', '')}&reviewId={rid}",
                published_at=published,
                title=f"Play Store review — {app} ({score}★): {content[:60]}"[:300],
                content=f"{score}★ review of {app}: {content}"[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 14, apps: list[tuple[str, str]] | None = None) -> list[Event]:
    try:
        from google_play_scraper import Sort, reviews  # lazy: optional dep
    except ImportError:
        LOGGER.debug("playstore-reviews skipped: google-play-scraper not installed")
        return []

    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    for name, pkg in (apps or _apps_from_env()):
        try:
            rows, _ = reviews(pkg, lang="en", country="us", sort=Sort.NEWEST, count=PER_APP)
            for r in rows:
                r["_appId"] = pkg
            out.extend(reviews_to_events(name, rows, since))
        except Exception as exc:  # noqa: BLE001 — one app's failure must not abort the rest
            LOGGER.debug("playstore-reviews %s failed: %s", name, exc)
    return out
