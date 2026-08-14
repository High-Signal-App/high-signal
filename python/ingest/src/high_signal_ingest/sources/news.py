"""News + blog RSS adapter — reads sources.yaml, extracts article text concurrently."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Iterator

import feedparser
import httpx

from ..seed import load_sources
from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 (+https://github.com/sarthakagrawal927)"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 16
PER_HOST_CONCURRENCY = 4


def _parse_rfc822(s: str) -> datetime | None:
    try:
        d = parsedate_to_datetime(s)
        return d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _parse_iso(s: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _extract_article_text(html: str) -> str:
    try:
        import trafilatura

        text = (
            trafilatura.extract(
                html,
                include_comments=False,
                include_tables=False,
                fast=True,
            )
            or ""
        )
        if len(text) >= 500:
            return text[:30_000]
    except Exception as exc:
        LOGGER.debug("trafilatura extraction failed: %s", exc)
    try:
        from newspaper import fulltext

        return (fulltext(html) or "")[:30_000]
    except Exception as exc:
        LOGGER.debug("newspaper extraction failed: %s", exc)
        return ""


def _parse_feed(xml_text: str) -> list[dict]:
    """Parse RSS/Atom into {title, link, pub} dicts."""
    out: list[dict] = []
    parsed = feedparser.parse(xml_text)
    if getattr(parsed, "bozo", False):
        LOGGER.debug("feedparser marked feed as bozo: %s", getattr(parsed, "bozo_exception", ""))
    for entry in parsed.entries:
        link = (entry.get("link") or "").strip()
        if not link:
            continue
        out.append(
            {
                "title": (entry.get("title") or "").strip(),
                "link": link,
                "pub": (
                    entry.get("published") or entry.get("updated") or entry.get("created") or ""
                ).strip(),
            }
        )
    return out


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            LOGGER.debug("fetch failed url=%s status=%s", url, r.status_code)
            return ""
        return r.text
    except httpx.HTTPError as exc:
        LOGGER.debug("fetch failed url=%s error=%s", url, exc)
        return ""


async def _extract_body(client: httpx.AsyncClient, url: str, semaphore: asyncio.Semaphore) -> str:
    async with semaphore:
        html = await _fetch_text(client, url)
    if not html:
        return ""
    return await asyncio.to_thread(_extract_article_text, html)


async def fetch_rss_async(
    source: dict,
    since: datetime,
    client: httpx.AsyncClient,
    body_semaphore: asyncio.Semaphore,
    fetch_body: bool = False,
) -> list[Event]:
    """Pull a single RSS source. `source` is one entry from sources.yaml."""
    url = source.get("rss")
    if not url:
        return []
    xml_text = await _fetch_text(client, url)
    if not xml_text:
        return []
    items = _parse_feed(xml_text)
    candidates: list[tuple[dict, datetime]] = []
    for it in items:
        pub_raw = it["pub"]
        pub = _parse_rfc822(pub_raw) or _parse_iso(pub_raw)
        if pub is None:
            continue
        if pub < since:
            continue
        candidates.append((it, pub))

    body_tasks: dict[str, asyncio.Task[str]] = {}
    if fetch_body:
        for it, _pub in candidates:
            link = it["link"]
            if link not in body_tasks:
                body_tasks[link] = asyncio.create_task(_extract_body(client, link, body_semaphore))
    out: list[Event] = []
    for it, pub in candidates:
        link = it["link"]
        body = await body_tasks[link] if fetch_body else ""
        raw_hash = event_hash(source["id"], link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"news:{source['id']}",
                source_url=link,
                published_at=pub,
                title=it.get("title") or None,
                content=body or None,
                primary_entity_id=None,  # filled later by entity extractor
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_rss(source: dict, since: datetime, fetch_body: bool = False) -> Iterator[Event]:
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY, max_keepalive_connections=8)
    headers = {"User-Agent": USER_AGENT}

    async def _run() -> list[Event]:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=timeout, limits=limits
        ) as client:
            semaphore = asyncio.Semaphore(PER_HOST_CONCURRENCY)
            return await fetch_rss_async(source, since, client, semaphore, fetch_body=fetch_body)

    yield from asyncio.run(_run())


async def fetch_all_async(
    days: int = 1,
    tier_max: int = 2,
    fetch_body: bool = True,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    sources: list[dict] = []
    for src in load_sources():
        if src.get("type") != "blog" and src.get("type") != "news_outlet":
            continue
        if int(src.get("tier", 99)) > tier_max:
            continue
        sources.append(src)

    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    headers = {"User-Agent": USER_AGENT}
    body_semaphore = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(
        headers=headers,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
    ) as client:
        tasks = [
            fetch_rss_async(src, since, client, body_semaphore, fetch_body=fetch_body)
            for src in sources
        ]
        batches = await asyncio.gather(*tasks)
    return [event for batch in batches for event in batch]


def fetch_all(days: int = 1, tier_max: int = 2, fetch_body: bool = True) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, tier_max=tier_max, fetch_body=fetch_body))
