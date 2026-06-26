"""Apple App Store customer-reviews adapter (free, key-less).

Product-perception + idea-mining signal (§4 + new-ideas): real user reviews of
notable apps — complaints are pain-points, praise is demand. Uses Apple's
key-less iTunes feeds: the Search API resolves a brand name → app id, then the
customer-reviews RSS returns recent reviews. No scraping, no key.

Seed brands via `APPSTORE_REVIEW_APPS` (comma-separated names); defaults to a
curated tech/consumer set. Point it at a connected brand's app for §4.

Output: Events tagged `source: appstore-reviews`.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

from ..types import Event

USER_AGENT = "high-signal/0.1 appstore-reviews-ingest"
LOGGER = logging.getLogger(__name__)
SEARCH_URL = "https://itunes.apple.com/search"
REVIEWS_URL = "https://itunes.apple.com/us/rss/customerreviews/page=1/id={app_id}/sortby=mostrecent/json"
DEFAULT_APPS = (
    "ChatGPT", "Perplexity AI", "Claude by Anthropic", "Notion", "Cursor",
    "Figma", "Robinhood", "Coinbase", "Duolingo", "Arc Search",
)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _apps_from_env() -> list[str]:
    raw = os.environ.get("APPSTORE_REVIEW_APPS", "").strip()
    if not raw:
        return list(DEFAULT_APPS)
    return [a.strip() for a in raw.split(",") if a.strip()]


def _parse_dt(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value)
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def reviews_from_feed(app: str, payload: dict, since: datetime) -> list[Event]:
    entries = payload.get("feed", {}).get("entry", []) if isinstance(payload, dict) else []
    out: list[Event] = []
    for e in entries:
        if not isinstance(e, dict) or "im:rating" not in e:
            continue  # first entry is app metadata, not a review
        rating = (e.get("im:rating") or {}).get("label", "")
        title = (e.get("title") or {}).get("label", "").strip()
        body = (e.get("content") or {}).get("label", "").strip()
        rid = (e.get("id") or {}).get("label", "").strip()
        published = _parse_dt((e.get("updated") or {}).get("label", ""))
        if not rid or not title or published is None or published < since:
            continue
        raw_hash = _hash("appstore-reviews", rid)
        link = (e.get("link") or {}).get("attributes", {}).get("href", "https://apps.apple.com")
        # Distinct per review so write-path dedup doesn't collapse all of an
        # app's reviews (they share the app link).
        source_url = f"{link}{'&' if '?' in link else '?'}reviewId={rid}"
        out.append(
            Event(
                id=raw_hash[:16],
                source="appstore-reviews",
                source_url=source_url,
                published_at=published,
                title=f"App Store review — {app} ({rating}★): {title}"[:300],
                content=f"{rating}★ review of {app}: {body}"[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def _resolve_app_id(client: httpx.Client, name: str) -> str | None:
    try:
        r = client.get(SEARCH_URL, params={"term": name, "entity": "software", "limit": 1, "country": "us"})
        r.raise_for_status()
        results = r.json().get("results", [])
        return str(results[0]["trackId"]) if results else None
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None


def fetch_all(days: int = 14, apps: list[str] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20.0, follow_redirects=True) as c:
        for name in (apps or _apps_from_env()):
            app_id = _resolve_app_id(c, name)
            if not app_id:
                continue
            try:
                r = c.get(REVIEWS_URL.format(app_id=app_id))
                r.raise_for_status()
                out.extend(reviews_from_feed(name, r.json(), since))
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("appstore-reviews %s failed: %s", name, exc)
    return out
