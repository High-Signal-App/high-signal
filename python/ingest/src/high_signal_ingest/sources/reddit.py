"""Reddit adapter — uses OAuth (script-app flow) or RSS with rate-limiting.

Reddit tightened their public API in 2023: unauthenticated requests to
``/r/{sub}/new.json`` now return 403 from most IPs. This adapter supports
two modes:

1. **OAuth (preferred)** — if ``REDDIT_CLIENT_ID`` + ``REDDIT_CLIENT_SECRET``
   are set, the adapter fetches a bearer token via the script-app flow
   (``POST /api/v1/access_token`` with HTTP basic auth) and uses it for
   authenticated JSON requests. This is the reliable path.

2. **RSS fallback** — if no credentials are set (or the token fetch fails),
   the adapter falls back to ``/r/{sub}/.rss``. The JSON endpoint is fully
   blocked (403), so we skip it entirely and go straight to RSS. RSS works
   but is rate-limited to ~2 requests/second, so we add a delay between
   requests to avoid 429s.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Iterator

import httpx
import feedparser

from ..types import Event


# Reddit requires a unique, descriptive User-Agent. Generic ones get blocked.
USER_AGENT = "linux:high-signal:0.1.0 (by /u/sarthak_research)"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 4  # Lower for RSS to avoid 429s
DEFAULT_MIN_SCORE = 10
RSS_DELAY = 2.0  # seconds between RSS requests per sub

# Global semaphore: limits concurrent Reddit requests to 1, so even when
# 20 niches run via asyncio.gather, Reddit sees at most 1 request at a time.
# Without this, 20 concurrent RSS requests → instant 429.
_RSS_SEMAPHORE = asyncio.Semaphore(1)

# OAuth token cache (process-lifetime). Avoids re-fetching a token per sub.
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}
_TOKEN_TTL = 3300  # Reddit tokens last 1 hour; refresh at 55 min.

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


async def _get_oauth_token(client: httpx.AsyncClient) -> str | None:
    """Fetch a Reddit OAuth bearer token (script-app flow).

    Requires ``REDDIT_CLIENT_ID`` and ``REDDIT_CLIENT_SECRET`` env vars.
    Returns ``None`` if credentials are missing or the token fetch fails.
    """
    client_id = os.environ.get("REDDIT_CLIENT_ID", "")
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None

    cached = _TOKEN_CACHE.get("token")
    if cached and cached[1] > time.time():
        return cached[0]

    try:
        r = await client.post(
            "https://www.reddit.com/api/v1/access_token",
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
            headers={"User-Agent": USER_AGENT},
        )
        r.raise_for_status()
        token = r.json().get("access_token")
        if token:
            _TOKEN_CACHE["token"] = (token, time.time() + _TOKEN_TTL)
            LOGGER.info("reddit oauth token acquired")
            return token
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        LOGGER.warning("reddit oauth token fetch failed: %s", exc)
    return None


async def fetch_subreddit_async(
    sub: str,
    since: datetime,
    client: httpx.AsyncClient,
    limit: int = 100,
    min_score: int = DEFAULT_MIN_SCORE,
) -> list[Event]:
    # Try OAuth-authenticated JSON first (if credentials are configured).
    token = await _get_oauth_token(client)
    if token:
        url = f"https://oauth.reddit.com/r/{sub}/new?limit={limit}"
        headers = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
        try:
            r = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            LOGGER.debug("reddit oauth fetch failed sub=%s error=%s", sub, exc)
            return await fetch_subreddit_rss_async(sub, since, client, limit=limit)
        if r.status_code == 200:
            return _parse_reddit_json(r.json(), sub, since, min_score)
        LOGGER.debug("reddit oauth fetch sub=%s status=%s", sub, r.status_code)
        # Fall through to RSS.

    # No OAuth token (or OAuth failed) → skip the unauthenticated JSON
    # endpoint entirely (it returns 403 from most IPs) and go straight to
    # RSS with rate-limiting. The semaphore ensures only 1 Reddit request
    # is in flight at a time across all concurrent callers.
    async with _RSS_SEMAPHORE:
        await asyncio.sleep(RSS_DELAY)
        return await fetch_subreddit_rss_async(sub, since, client, limit=limit)


def _parse_reddit_json(
    data: dict, sub: str, since: datetime, min_score: int
) -> list[Event]:
    """Parse Reddit JSON ``data`` into Events. Shared by OAuth + unauth paths."""
    children = data.get("data", {}).get("children", [])
    out: list[Event] = []
    for c in children:
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
    url = f"https://www.reddit.com/r/{sub}/.rss"
    try:
        r = await client.get(url)
    except httpx.HTTPError as exc:
        LOGGER.debug("reddit rss fetch failed sub=%s error=%s", sub, exc)
        return []
    if r.status_code == 429:
        # Rate-limited — wait longer and retry once.
        retry_after = float(r.headers.get("retry-after", "10"))
        wait = min(max(retry_after, 5), 30)
        LOGGER.info("reddit rss 429 sub=%s, retrying after %.1fs", sub, wait)
        await asyncio.sleep(wait)
        try:
            r = await client.get(url)
        except httpx.HTTPError as exc:
            LOGGER.debug("reddit rss retry failed sub=%s error=%s", sub, exc)
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
