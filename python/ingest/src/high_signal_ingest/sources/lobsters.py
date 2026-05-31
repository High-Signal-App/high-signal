"""Lobste.rs adapter.

Small technical weak-signal source. This intentionally uses the public RSS feed
instead of broad social firehose ingestion.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Iterator

import feedparser
import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 lobsters-ingest"
LOGGER = logging.getLogger(__name__)
RSS_URL = "https://lobste.rs/rss"
RELEVANT_TERMS = (
    "ai",
    "llm",
    "machine learning",
    "gpu",
    "compiler",
    "database",
    "postgres",
    "sqlite",
    "infra",
    "infrastructure",
    "cloud",
    "linux",
    "nixos",
    "kubernetes",
    "security",
    "vulnerability",
    "exploit",
    "cve",
    "performance",
    "rust",
    "zig",
    "python",
    "typescript",
    "javascript",
    "golang",
    "open source",
    "release",
)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _parse_published(value: str) -> datetime | None:
    try:
        parsed = parsedate_to_datetime(value)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return None


def _is_relevant(title: str, summary: str, tags: list[str]) -> bool:
    text = f"{title} {summary} {' '.join(tags)}".lower()
    return any(term in text for term in RELEVANT_TERMS)


def events_from_feed(xml: str, since: datetime) -> list[Event]:
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries[:50]:
        link = (entry.get("link") or "").strip()
        if not link:
            continue
        published = _parse_published(entry.get("published") or entry.get("updated") or "")
        if published is None or published < since:
            continue
        title = (entry.get("title") or "").strip()
        summary = (entry.get("summary") or entry.get("description") or "").strip()
        tags = [str(tag.get("term")) for tag in entry.get("tags", []) if tag.get("term")]
        if not _is_relevant(title, summary, tags):
            continue
        tag_text = f"\nTags: {', '.join(tags)}" if tags else ""
        raw_hash = _hash("lobsters", link)
        out.append(
            Event(
                id=raw_hash[:16],
                source="lobsters",
                source_url=link,
                published_at=published,
                title=title or None,
                content=(summary + tag_text).strip()[:20_000] or None,
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
        LOGGER.debug("lobsters fetch failed error=%s", exc)
        return []
    return events_from_feed(response.text, since)


def fetch_recent(days: int = 3) -> Iterator[Event]:
    yield from fetch_all(days=days)
