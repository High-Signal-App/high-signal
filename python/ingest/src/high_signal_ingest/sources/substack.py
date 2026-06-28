"""Curated Substack RSS adapter.

Substack is treated as a weak-signal/corroboration source, not a broad social
firehose. Keep the feed list curated to writers whose posts regularly explain
technology, startup, or AI-infrastructure shifts.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 substack-ingest"
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SubstackFeed:
    id: str
    title: str
    url: str


FEEDS = [
    SubstackFeed("pragmatic-engineer", "The Pragmatic Engineer", "https://newsletter.pragmaticengineer.com/feed"),
    SubstackFeed("lennys-newsletter", "Lenny's Newsletter", "https://www.lennysnewsletter.com/feed"),
    SubstackFeed("latent-space", "Latent Space", "https://www.latent.space/feed"),
    # import-ai removed — already in sources.yaml as ml-import-ai (news adapter fetches it)
]

RELEVANT_TERMS = (
    "ai",
    "agent",
    "developer",
    "startup",
    "pricing",
    "open source",
    "model",
    "gpu",
    "infrastructure",
    "security",
    "enterprise",
    "workflow",
    "product",
    "growth",
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


def _relevant(title: str, summary: str) -> bool:
    text = f"{title} {summary}".lower()
    return any(term in text for term in RELEVANT_TERMS)


def events_from_feed(feed: SubstackFeed, xml: str, since: datetime) -> list[Event]:
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries[:25]:
        link = (entry.get("link") or "").strip()
        if not link:
            continue
        published = _parse_published(entry.get("published") or entry.get("updated") or "")
        if published is None or published < since:
            continue
        title = (entry.get("title") or "").strip()
        summary = (entry.get("summary") or entry.get("description") or "").strip()
        if not _relevant(title, summary):
            continue
        raw_hash = _hash("substack", feed.id, link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"substack:{feed.id}",
                source_url=link,
                published_at=published,
                title=title or None,
                content=summary[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 7, feeds: list[SubstackFeed] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for feed in feeds or FEEDS:
            try:
                response = client.get(feed.url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                LOGGER.debug("substack fetch failed feed=%s error=%s", feed.id, exc)
                continue
            out.extend(events_from_feed(feed, response.text, since))
    return out
