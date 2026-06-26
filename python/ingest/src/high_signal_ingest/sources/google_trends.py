"""Google Trends adapter (daily trending-searches RSS, free, key-less).

The one **demand-side** signal in the pipeline: what people are searching for
right now. Feeds the "new ideas / business ideas / trends" domain, where every
other source is supply-side (what's being built/shipped). Uses the public daily
trends RSS (key-less); the `pytrends` library is avoided because Google
rate-limits/breaks it.

Trending terms are inherently noisy (sports, celebrities, news), so these are
entity-less demand pulses — the grouping/curation layer decides what matters.

Output: Events tagged `source: google-trends`. No key required.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from ..types import Event

USER_AGENT = "high-signal/0.1 google-trends-ingest"
LOGGER = logging.getLogger(__name__)
# (geo, feed_url)
DEFAULT_GEOS: tuple[tuple[str, str], ...] = (
    ("US", "https://trends.google.com/trending/rss?geo=US"),
    ("GB", "https://trends.google.com/trending/rss?geo=GB"),
)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _published(entry: object) -> datetime | None:
    raw = getattr(entry, "published", None) or getattr(entry, "updated", None)
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(str(raw))
    except (TypeError, ValueError):
        return None
    return None if dt is None else (dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc))


def events_from_feed(geo: str, xml: str, since: datetime) -> list[Event]:
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries:
        term = (getattr(entry, "title", "") or "").strip()
        if not term:
            continue
        published = _published(entry) or datetime.now(timezone.utc)
        if published < since:
            continue
        traffic = (getattr(entry, "ht_approx_traffic", "") or "").strip()
        raw_hash = _hash("google-trends", geo, term, published.date().isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"google-trends:{geo.lower()}",
                source_url=f"https://trends.google.com/trending?geo={geo}",
                published_at=published,
                title=f"Trending search ({geo}): {term}",
                content=(f"Approx. searches: {traffic}." if traffic else "Trending search term."),
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 2, geos: tuple[tuple[str, str], ...] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20.0, follow_redirects=True) as c:
        for geo, url in (geos or DEFAULT_GEOS):
            try:
                r = c.get(url)
                r.raise_for_status()
                out.extend(events_from_feed(geo, r.text, since))
            except httpx.HTTPError as exc:
                LOGGER.debug("google-trends %s failed: %s", geo, exc)
    return out
