"""Bluesky AT Protocol search adapter.

Uses app.bsky.feed.searchPosts with an optional session created from
``BLUESKY_IDENTIFIER`` and ``BLUESKY_APP_PASSWORD``. Without credentials this
source returns no events.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 bluesky-ingest"
LOGGER = logging.getLogger(__name__)
BASE_URL = "https://bsky.social/xrpc"


@dataclass(frozen=True)
class BlueskyQuery:
    query: str
    entity_id: str | None = None


QUERIES = [
    BlueskyQuery("AI accelerator", "NVDA"),
    BlueskyQuery("LLM inference"),
    BlueskyQuery("data center power"),
    BlueskyQuery("startup funding"),
]


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (
            parsed.astimezone(timezone.utc)
            if parsed.tzinfo
            else parsed.replace(tzinfo=timezone.utc)
        )
    except ValueError:
        return None


def events_from_response(
    query: BlueskyQuery, payload: dict[str, Any], since: datetime
) -> list[Event]:
    posts = payload.get("posts") if isinstance(payload.get("posts"), list) else []
    out: list[Event] = []
    for post in posts:
        if not isinstance(post, dict):
            continue
        uri = str(post.get("uri") or "").strip()
        indexed = _parse_datetime(str(post.get("indexedAt") or ""))
        record = post.get("record") if isinstance(post.get("record"), dict) else {}
        text = str(record.get("text") or "").strip()
        author = post.get("author") if isinstance(post.get("author"), dict) else {}
        handle = str(author.get("handle") or "").strip()
        if not uri or indexed is None or indexed < since or not text:
            continue
        raw_hash = event_hash("bluesky", query.query, uri)
        out.append(
            Event(
                id=raw_hash[:16],
                source="bluesky",
                source_url=f"https://bsky.app/profile/{handle}/post/{uri.rsplit('/', 1)[-1]}"
                if handle
                else "https://bsky.app",
                published_at=indexed,
                title=f"Bluesky post: {query.query}",
                content=text[:20_000],
                primary_entity_id=query.entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def _session_token(client: httpx.Client) -> str | None:
    identifier = os.environ.get("BLUESKY_IDENTIFIER")
    password = os.environ.get("BLUESKY_APP_PASSWORD")
    if not identifier or not password:
        LOGGER.debug("bluesky skipped: BLUESKY_IDENTIFIER/BLUESKY_APP_PASSWORD not set")
        return None
    try:
        response = client.post(
            f"{BASE_URL}/com.atproto.server.createSession",
            json={"identifier": identifier, "password": password},
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("bluesky session failed error=%s", exc)
        return None
    return str(payload.get("accessJwt") or "") or None


def fetch_all(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        token = _session_token(client)
        if not token:
            return []
        headers = {"Authorization": f"Bearer {token}"}
        for query in QUERIES:
            try:
                response = client.get(
                    f"{BASE_URL}/app.bsky.feed.searchPosts",
                    params={"q": query.query, "limit": 25, "sort": "latest"},
                    headers=headers,
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("bluesky fetch failed query=%s error=%s", query.query, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(query, payload, since))
    return out
