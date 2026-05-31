"""Reddit adapter — uses the public JSON endpoint (no auth needed for read-only)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterator

import httpx
import feedparser

from ..types import Event


USER_AGENT = "high-signal/0.1 reddit-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 8
DEFAULT_MIN_SCORE = 10

DEFAULT_SUBS = [
    "hardware",
    "semiconductors",
    "AMD_Stock",
    "NVDA_Stock",
    "MachineLearning",
    "LocalLLaMA",
    "datacenter",
    "startups",
    "SaaS",
    "indiehackers",
    "ExperiencedDevs",
    "webdev",
    "devops",
]


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


async def fetch_subreddit_async(
    sub: str,
    since: datetime,
    client: httpx.AsyncClient,
    limit: int = 100,
    min_score: int = DEFAULT_MIN_SCORE,
) -> list[Event]:
    url = f"https://www.reddit.com/r/{sub}/new.json?limit={limit}"
    try:
        r = await client.get(url)
    except httpx.HTTPError as exc:
        LOGGER.debug("reddit fetch failed sub=%s error=%s", sub, exc)
        return []
    if r.status_code == 403:
        return await fetch_subreddit_rss_async(sub, since, client, limit=limit)
    if r.status_code != 200:
        LOGGER.debug("reddit fetch failed sub=%s status=%s", sub, r.status_code)
        return []
    try:
        data = r.json().get("data", {}).get("children", [])
    except ValueError as exc:
        LOGGER.debug("reddit json parse failed sub=%s error=%s", sub, exc)
        return []
    out: list[Event] = []
    for c in data:
        d = c.get("data", {})
        created = d.get("created_utc")
        if not created:
            continue
        pub = datetime.fromtimestamp(float(created), tz=timezone.utc)
        if pub < since:
            continue
        permalink = "https://reddit.com" + d.get("permalink", "")
        title = d.get("title", "")
        body = d.get("selftext", "")
        if d.get("score", 0) < min_score:
            # Skip low-signal posts
            continue
        raw_hash = _hash("reddit", sub, permalink)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"reddit:{sub}",
                source_url=permalink,
                published_at=pub,
                title=title or None,
                content=body or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_subreddit_rss_async(
    sub: str,
    since: datetime,
    client: httpx.AsyncClient,
    limit: int = 100,
) -> list[Event]:
    url = f"https://www.reddit.com/r/{sub}/new/.rss"
    try:
        r = await client.get(url)
    except httpx.HTTPError as exc:
        LOGGER.debug("reddit rss fetch failed sub=%s error=%s", sub, exc)
        return []
    if r.status_code != 200:
        LOGGER.debug("reddit rss fetch failed sub=%s status=%s", sub, r.status_code)
        return []
    parsed = feedparser.parse(r.text)
    out: list[Event] = []
    for entry in parsed.entries[:limit]:
        published = entry.get("published") or entry.get("updated") or ""
        try:
            pub = datetime.fromisoformat(published.replace("Z", "+00:00"))
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if pub < since:
            continue
        link = (entry.get("link") or "").strip()
        title = (entry.get("title") or "").strip()
        summary = (entry.get("summary") or "").strip()
        if not link or not title:
            continue
        raw_hash = _hash("reddit-rss", sub, link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"reddit:{sub}",
                source_url=link,
                published_at=pub,
                title=title,
                content=summary[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_subreddit(sub: str, since: datetime, limit: int = 100) -> Iterator[Event]:
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY, max_keepalive_connections=4)
    headers = {"User-Agent": USER_AGENT}

    async def _run() -> list[Event]:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=timeout, limits=limits
        ) as client:
            return await fetch_subreddit_async(sub, since, client, limit=limit)

    yield from asyncio.run(_run())


async def fetch_all_async(
    days: int = 1,
    subs: list[str] | None = None,
    min_score: int = DEFAULT_MIN_SCORE,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY, max_keepalive_connections=4)
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(
        headers=headers,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
    ) as client:
        batches = await asyncio.gather(
            *(fetch_subreddit_async(sub, since, client, min_score=min_score) for sub in subs or DEFAULT_SUBS)
        )
    return [event for batch in batches for event in batch]


def fetch_all(days: int = 1, subs: list[str] | None = None, min_score: int = DEFAULT_MIN_SCORE) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, subs=subs, min_score=min_score))
