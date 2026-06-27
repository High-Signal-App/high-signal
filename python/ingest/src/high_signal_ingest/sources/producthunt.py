"""Product Hunt adapter (public RSS, free, key-less).

New product launches — a direct **startups** signal (what's being built and
shipped today). Uses the public RSS feed rather than the GraphQL API, which
needs an OAuth developer token; the feed is key-less.

Output: Events tagged `source: producthunt`. No key required.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import feedparser
import httpx

from ..types import Event
from ..utils import event_hash, rss_published

USER_AGENT = "high-signal/0.1 producthunt-ingest"
LOGGER = logging.getLogger(__name__)
FEED_URL = "https://www.producthunt.com/feed"


def events_from_feed(xml: str, since: datetime) -> list[Event]:
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries:
        title = (getattr(entry, "title", "") or "").strip()
        link = (getattr(entry, "link", "") or "").strip()
        if not title or not link or title.lower().startswith("product hunt"):
            continue
        published = rss_published(entry)
        if published is None or published < since:
            continue
        summary = (getattr(entry, "summary", "") or "").strip()
        raw_hash = event_hash("producthunt", link)
        out.append(
            Event(
                id=raw_hash[:16],
                source="producthunt",
                source_url=link,
                published_at=published,
                title=f"Product Hunt launch: {title}",
                content=summary[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20.0, follow_redirects=True) as c:
            r = c.get(FEED_URL)
            r.raise_for_status()
            xml = r.text
    except httpx.HTTPError as exc:
        LOGGER.debug("producthunt fetch failed: %s", exc)
        return []
    return events_from_feed(xml, since)
