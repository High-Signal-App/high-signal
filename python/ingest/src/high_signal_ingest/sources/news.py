"""News + blog RSS adapter — reads sources.yaml, extracts article text concurrently."""

from __future__ import annotations

import asyncio
import logging
import re
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Iterator
from urllib.parse import urljoin

import feedparser
import httpx

from ..seed import load_sources
from .. import audit
from ..types import Event
from ..utils import event_hash
from . import registered_feeds


USER_AGENT = "high-signal/0.1 (+https://github.com/sarthakagrawal927)"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 16
PER_HOST_CONCURRENCY = 4


class _FeedText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"p", "br", "div", "li"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def _feed_text(entry: dict) -> str:
    values = [part.get("value", "") for part in entry.get("content", [])]
    values.append(entry.get("summary") or entry.get("description") or "")
    texts: list[str] = []
    for value in values:
        parser = _FeedText()
        parser.feed(value)
        texts.append(" ".join("".join(parser.parts).split()))
    return max(texts, key=len, default="")[:30_000]


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


def _parse_feed(xml_text: str, *, base_url: str = "", require_feed: bool = False) -> list[dict]:
    """Parse RSS/Atom into {title, link, pub} dicts."""
    out: list[dict] = []
    if require_feed:
        markup = re.sub(r"<!\[CDATA\[[\s\S]*?\]\]>", "", xml_text)
        if re.search(r"<!DOCTYPE|<!ENTITY", markup, re.I):
            raise registered_feeds.PublicFeedFetchError(
                "Response is not a supported RSS or Atom feed"
            )
    parsed = feedparser.parse(xml_text)
    if require_feed and not parsed.get("version"):
        raise registered_feeds.PublicFeedFetchError("Response is not a supported RSS or Atom feed")
    if getattr(parsed, "bozo", False):
        LOGGER.debug("feedparser marked feed as bozo: %s", getattr(parsed, "bozo_exception", ""))
    for entry in parsed.entries:
        raw_link = (entry.get("link") or "").strip()
        if not raw_link:
            continue
        link = urljoin(base_url, raw_link)
        item = {
            "title": (entry.get("title") or "").strip(),
            "link": link,
            "pub": (
                entry.get("published") or entry.get("updated") or entry.get("created") or ""
            ).strip(),
        }
        retained = _feed_text(entry)
        if retained:
            item["content"] = retained
        out.append(item)
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


async def _extract_body(
    client: httpx.AsyncClient, url: str, semaphore: asyncio.Semaphore, *, public_only: bool = False
) -> str | None:
    async with semaphore:
        if public_only:
            try:
                html = (await registered_feeds.fetch_public_document(client, url)).text
            except registered_feeds.UnsafeFeedUrl:
                return None
            except (registered_feeds.PublicFeedFetchError, httpx.HTTPError, TimeoutError):
                html = ""
        else:
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
    registered = bool(source.get("_registry_id"))
    async with body_semaphore:
        if registered:
            document = await registered_feeds.fetch_public_document(client, url)
            xml_text, url = document.text, document.url
        else:
            xml_text = await _fetch_text(client, url)
    if not xml_text:
        return []
    items = _parse_feed(xml_text, base_url=url, require_feed=registered)
    candidates: list[tuple[dict, datetime]] = []
    for it in items:
        if registered:
            try:
                registered_feeds.public_url(it["link"])
            except registered_feeds.UnsafeFeedUrl:
                continue
        pub_raw = it["pub"]
        pub = _parse_rfc822(pub_raw) or _parse_iso(pub_raw)
        if pub is None:
            continue
        if pub < since:
            continue
        candidates.append((it, pub))

    if registered:
        candidates = sorted(candidates, key=lambda item: item[1], reverse=True)[:50]

    body_tasks: dict[str, asyncio.Task[str | None]] = {}
    if fetch_body:
        for it, _pub in candidates:
            link = it["link"]
            if link not in body_tasks:
                body_tasks[link] = asyncio.create_task(
                    _extract_body(client, link, body_semaphore, public_only=registered)
                )
    out: list[Event] = []
    for it, pub in candidates:
        link = it["link"]
        body = await body_tasks[link] if fetch_body else ""
        if body is None:
            continue
        raw_hash = event_hash(source["id"], link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"news:{source['id']}",
                source_url=link,
                published_at=pub,
                title=it.get("title") or None,
                content=body or it.get("content") or None,
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
    registry = await asyncio.to_thread(audit.fetch_feed_sources)
    sources = registered_feeds.merge_sources(load_sources(), registry, tier_max)

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
            _fetch_source(src, since, client, body_semaphore, fetch_body=fetch_body)
            for src in sources
        ]
        batches = await asyncio.gather(*tasks)
    return [event for batch in batches for event in batch]


async def _fetch_source(
    source: dict,
    since: datetime,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    *,
    fetch_body: bool,
) -> list[Event]:
    if not source.get("_registry_id"):
        return await fetch_rss_async(source, since, client, semaphore, fetch_body=fetch_body)
    fetched_at = int(datetime.now(timezone.utc).timestamp())
    events: list[Event] = []
    error = None
    try:
        events = await fetch_rss_async(source, since, client, semaphore, fetch_body=fetch_body)
    except registered_feeds.PublicFeedFetchError as exc:
        error = str(exc)
    except (httpx.HTTPError, TimeoutError) as exc:
        error = f"Feed fetch failed ({type(exc).__name__})"
    await registered_feeds.report_fetch(
        source,
        fetched_at=fetched_at,
        count=len(events),
        error=error,
        published_at=max((int(event.published_at.timestamp()) for event in events), default=None),
    )
    return events


def fetch_all(days: int = 1, tier_max: int = 2, fetch_body: bool = True) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, tier_max=tier_max, fetch_body=fetch_body))
