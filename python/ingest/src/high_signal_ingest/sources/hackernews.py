"""Hacker News adapter (Algolia API, free, key-less).

Hacker News is the largest tech / startup discourse signal we weren't ingesting
directly (only inside Lab). The Algolia search API is free and key-less. We pull
recent, well-upvoted stories scoped to the three domains, plus Show HN launches
(a startup / product-launch signal). Company names in titles map to tracked
entities downstream; the rest feeds the technology and startup domains
thematically.

Output: Events tagged `source: hackernews`. No key required.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 hackernews-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://hn.algolia.com/api/v1/search_by_date"
ITEM_URL = "https://news.ycombinator.com/item?id="
MIN_POINTS = 10  # curation floor — skip low-signal noise
PAGES = 2  # Algolia pages to pull per query (1000 hits max/query overall)

# (query, tag, min_points). tag=story for topical front-page items, show_hn for
# launches (kept at a lower floor since launches start small). Broad coverage
# across the three domains — fetch wide, store lean (title + link + metadata).
QUERIES: tuple[tuple[str, str, int], ...] = (
    ("artificial intelligence", "story", MIN_POINTS),
    ("GPU OR datacenter OR semiconductor OR chip", "story", MIN_POINTS),
    ("startup OR funding OR acquisition OR IPO", "story", MIN_POINTS),
    ("cloud OR infrastructure OR kubernetes", "story", MIN_POINTS),
    ("AI agent OR LLM OR model", "story", MIN_POINTS),
    ("robotics OR autonomous", "story", MIN_POINTS),
    ("crypto OR stablecoin OR fintech", "story", MIN_POINTS),
    ("layoffs OR hiring OR enterprise", "story", 20),
    ("open source", "story", 30),
    ("", "show_hn", 8),
)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def events_from_response(payload: dict[str, Any], since: datetime) -> list[Event]:
    hits = payload.get("hits") if isinstance(payload.get("hits"), list) else []
    out: list[Event] = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        object_id = str(hit.get("objectID") or "").strip()
        title = str(hit.get("title") or "").strip()
        ts = hit.get("created_at_i")
        if not object_id or not title or not isinstance(ts, (int, float)):
            continue
        published = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        if published < since:
            continue
        points = hit.get("points") or 0
        comments = hit.get("num_comments") or 0
        ext_url = str(hit.get("url") or "").strip()
        content = "\n".join(
            part
            for part in [
                f"Points: {points} | Comments: {comments}",
                f"Author: {hit.get('author')}" if hit.get("author") else "",
                f"Link: {ext_url}" if ext_url else "",
                "",
                title,
            ]
            if part != ""
        )
        raw_hash = _hash("hackernews", object_id)
        out.append(
            Event(
                id=raw_hash[:16],
                source="hackernews",
                source_url=f"{ITEM_URL}{object_id}",
                published_at=published,
                title=f"HN: {title}",
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_ts = int(since.timestamp())
    out: list[Event] = []
    seen: set[str] = set()
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for query, tag, min_points in QUERIES:
            numeric = f"created_at_i>{since_ts},points>={min_points}"
            for page in range(PAGES):
                params = {
                    "tags": tag,
                    "numericFilters": numeric,
                    "hitsPerPage": 100,
                    "page": page,
                }
                if query:
                    params["query"] = query
                try:
                    resp = client.get(API_URL, params=params)
                    resp.raise_for_status()
                    payload = resp.json()
                except (httpx.HTTPError, ValueError) as exc:
                    LOGGER.debug("hackernews query=%r page=%d failed: %s", query, page, exc)
                    break
                if not isinstance(payload, dict):
                    break
                page_events = events_from_response(payload, since)
                for ev in page_events:
                    if ev.id not in seen:
                        seen.add(ev.id)
                        out.append(ev)
                if len(page_events) < 100:  # last page reached
                    break
    return out
