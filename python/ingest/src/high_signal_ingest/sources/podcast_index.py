"""Podcast Index adapter.

Requires ``PODCAST_INDEX_KEY`` and ``PODCAST_INDEX_SECRET``. This fetches
episode metadata for curated shows; Whisper transcription is a later processing
step because audio transcription should not run inside the daily fetcher.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event, SourceDocument


USER_AGENT = "high-signal/0.1 podcast-index-ingest"
LOGGER = logging.getLogger(__name__)
EPISODES_URL = "https://api.podcastindex.org/api/1.0/episodes/byfeedid"


@dataclass(frozen=True)
class PodcastFeed:
    name: str
    feed_id: int


FEEDS = [
    PodcastFeed("Latent Space", 5731786),
    PodcastFeed("20VC", 802199),
    PodcastFeed("Acquired", 1251427),
]


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _parse_epoch(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _auth_headers() -> dict[str, str] | None:
    key = os.environ.get("PODCAST_INDEX_KEY")
    secret = os.environ.get("PODCAST_INDEX_SECRET")
    if not key or not secret:
        LOGGER.debug("podcast index skipped: PODCAST_INDEX_KEY/PODCAST_INDEX_SECRET not set")
        return None
    auth_date = str(int(time.time()))
    auth = hashlib.sha1(f"{key}{secret}{auth_date}".encode("utf-8")).hexdigest()
    return {
        "User-Agent": USER_AGENT,
        "X-Auth-Key": key,
        "X-Auth-Date": auth_date,
        "Authorization": auth,
        "Accept": "application/json",
    }


def events_from_response(feed: PodcastFeed, payload: dict[str, Any], since: datetime) -> list[Event]:
    rows = payload.get("items") if isinstance(payload.get("items"), list) else []
    out: list[Event] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        episode_id = str(item.get("id") or "").strip()
        published = _parse_epoch(item.get("datePublished"))
        title = str(item.get("title") or "").strip()
        if not episode_id or published is None or published < since or not title:
            continue
        raw_hash = _hash("podcast-index", str(feed.feed_id), episode_id)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"podcast-index:{feed.feed_id}",
                source_url=str(item.get("link") or item.get("enclosureUrl") or ""),
                published_at=published,
                title=f"{feed.name}: {title}",
                content=str(item.get("description") or "")[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=str(item.get("link") or item.get("enclosureUrl") or ""),
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=item,
                    parsed_fields={
                        "feedId": feed.feed_id,
                        "feedName": feed.name,
                        "episodeId": episode_id,
                    },
                ),
            )
        )
    return out


def fetch_all(days: int = 14) -> list[Event]:
    headers = _auth_headers()
    if not headers:
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(headers=headers, timeout=20.0, follow_redirects=True) as client:
        for feed in FEEDS:
            try:
                response = client.get(EPISODES_URL, params={"id": feed.feed_id, "max": 10})
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("podcast index fetch failed feed=%s error=%s", feed.name, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(feed, payload, since))
    return out
