"""Techmeme RSS adapter.

Corroboration source, not a primary evidence firehose. Techmeme is useful when
an item has already crossed into mainstream tech/business attention.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Iterator

import feedparser
import httpx

from ..types import Event
from ..utils import event_hash, parse_published_datetime


USER_AGENT = "high-signal/0.1 techmeme-ingest"
LOGGER = logging.getLogger(__name__)
RSS_URL = "https://www.techmeme.com/feed.xml"
HREF_RE = re.compile(r"""<a\s+[^>]*href=["']([^"']+)["']""", re.IGNORECASE)


def _first_article_url(summary: str, fallback: str) -> str:
    for match in HREF_RE.finditer(summary):
        href = unescape(match.group(1)).strip()
        if href and "techmeme.com" not in href:
            return href
    return fallback


def events_from_feed(xml: str, since: datetime) -> list[Event]:
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries[:60]:
        permalink = (entry.get("link") or "").strip()
        if not permalink:
            continue
        published = parse_published_datetime(entry.get("published") or entry.get("updated") or "")
        if published is None or published < since:
            continue
        title = (entry.get("title") or "").strip()
        summary = (entry.get("summary") or entry.get("description") or "").strip()
        source_url = _first_article_url(summary, permalink)
        raw_hash = event_hash("techmeme", permalink)
        content = f"Techmeme permalink: {permalink}\n\n{summary}".strip()
        out.append(
            Event(
                id=raw_hash[:16],
                source="techmeme",
                source_url=source_url,
                published_at=published,
                title=title or None,
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 3, url: str = RSS_URL) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        response = httpx.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml"},
            timeout=20.0,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        LOGGER.debug("techmeme fetch failed error=%s", exc)
        return []
    return events_from_feed(response.text, since)


def fetch_recent(days: int = 3) -> Iterator[Event]:
    yield from fetch_all(days=days)
