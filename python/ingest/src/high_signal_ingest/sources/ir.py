"""IR (investor relations) page poller — checks IR pages for press releases."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterator
from urllib.parse import urlsplit

import httpx

from ..seed import load_entities, load_sources
from ..types import Entity, Event, SourceDocument
from ..utils import event_hash
from . import registered_feeds
from .ir_announcements import MAX_ANNOUNCEMENTS, announcement_event, retrieve_announcements


USER_AGENT = "high-signal/0.1 ir-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 16
MAX_RSS_ANNOUNCEMENTS = 3
MAX_RSS_BYTES = 2 * 1024 * 1024


def _ir_source_by_entity(entities: list[Entity], sources: list[dict]) -> dict[str, dict]:
    """Join curated IR feeds to exactly one entity by its configured IR URL."""
    source_matches: dict[str, list[dict]] = {}
    for source in sources:
        if source.get("type") != "ir_page" or not source.get("rss") or not source.get("url"):
            continue
        try:
            source_key = registered_feeds.feed_key(str(source["url"]))
        except (KeyError, TypeError, ValueError):
            continue
        matches = [
            entity
            for entity in entities
            if entity.ir_url and registered_feeds.feed_key(str(entity.ir_url)) == source_key
        ]
        if len(matches) != 1:
            continue
        source_matches.setdefault(matches[0].id, []).append(source)
    # Ambiguous seed configuration must not attach one publisher's source to
    # an arbitrary entity.
    return {entity_id: rows[0] for entity_id, rows in source_matches.items() if len(rows) == 1}


def _public_host(url: str) -> str | None:
    try:
        parsed = urlsplit(registered_feeds.public_url(url))
    except (ValueError, registered_feeds.UnsafeFeedUrl):
        return None
    if parsed.scheme != "https":
        return None
    host = parsed.hostname
    return host.lower().rstrip(".").removeprefix("www.") if host else None


async def _fetch_rss_announcements(
    entity_id: str,
    source: dict,
    client: httpx.AsyncClient,
    now: datetime,
) -> list[Event]:
    """Fetch recent dated announcement pages from an explicitly configured IR feed."""
    feed_url = source.get("rss")
    if not isinstance(feed_url, str) or not feed_url:
        return []
    configured_feed_host = _public_host(feed_url)
    if not configured_feed_host:
        return []
    try:
        feed = await registered_feeds.fetch_public_document(
            client,
            feed_url,
            max_bytes=int(source.get("feed_max_bytes") or MAX_RSS_BYTES),
        )
        feed_host = _public_host(feed.url)
        if feed_host != configured_feed_host:
            return []
        # Reuse the existing bounded public RSS parser/date validator. The
        # issuer article page remains the retained evidence document.
        from . import news

        items = news._parse_feed(
            feed.text,
            base_url=feed.url,
            require_feed=True,
            require_publication_date=True,
        )
        candidates = news._feed_candidates(items, now - timedelta(days=3), None)
    except Exception as exc:
        LOGGER.debug("ir rss fetch failed entity=%s error=%s", entity_id, type(exc).__name__)
        return []

    events: list[Event] = []
    eligible = [
        (item, published)
        for item, published in candidates
        if published <= datetime.now(timezone.utc)
        and isinstance(item.get("link"), str)
        and _public_host(item["link"]) == feed_host
    ]
    for item, _published in eligible[:MAX_RSS_ANNOUNCEMENTS]:
        link = item.get("link")
        assert isinstance(link, str)
        try:
            article = await registered_feeds.fetch_public_document(
                client, link, max_bytes=MAX_RSS_BYTES
            )
            if _public_host(article.url) != feed_host:
                continue
            event = await asyncio.to_thread(
                announcement_event,
                entity_id,
                article.url,
                article.text,
                now,
                published_at_hint=_published,
                publication_feed_url=feed.url,
            )
        except Exception as exc:
            LOGGER.debug("ir rss article failed entity=%s error=%s", entity_id, type(exc).__name__)
            continue
        if event is not None:
            events.append(event)
    return events


def _extract_ir_text(html: str) -> str:
    try:
        import trafilatura

        extracted = trafilatura.extract(
            html,
            include_links=True,
            include_comments=False,
            output_format="json",
            fast=True,
        )
    except Exception as exc:
        LOGGER.debug("ir extraction failed: %s", exc)
        return ""
    if not extracted:
        return ""
    import json as _json

    try:
        doc = _json.loads(extracted)
    except ValueError as exc:
        LOGGER.debug("ir extraction json parse failed: %s", exc)
        return ""
    return doc.get("text", "") or ""


async def poll_ir_page_async(
    entity_id: str,
    ir_url: str,
    client: httpx.AsyncClient,
    rss_source: dict | None = None,
) -> list[Event]:
    """Fetch an IR landing page and extract a text snapshot."""
    rss_task = (
        asyncio.create_task(
            _fetch_rss_announcements(entity_id, rss_source, client, datetime.now(timezone.utc))
        )
        if rss_source
        else None
    )
    try:
        try:
            r = await client.get(ir_url)
        except httpx.HTTPError as exc:
            LOGGER.debug("ir fetch failed entity=%s url=%s error=%s", entity_id, ir_url, exc)
            return await rss_task if rss_task else []
        if r.status_code != 200:
            LOGGER.debug(
                "ir fetch failed entity=%s url=%s status=%s", entity_id, ir_url, r.status_code
            )
            return await rss_task if rss_task else []
        announcements = await retrieve_announcements(entity_id, str(r.url), r.text, client)
        if rss_task:
            announcements.extend(await rss_task)
        announcements = list({event.source_url: event for event in announcements}.values())
        announcements.sort(key=lambda event: event.published_at, reverse=True)
        announcements = announcements[:MAX_ANNOUNCEMENTS]
        text = await asyncio.to_thread(_extract_ir_text, r.text)
        if not text:
            return announcements
        raw_hash = event_hash("ir", entity_id, ir_url, str(datetime.now(timezone.utc).date()))
        return [
            *announcements,
            Event(
                id=raw_hash[:16],
                source=f"ir:{entity_id}",
                source_url=ir_url,
                published_at=datetime.now(timezone.utc),
                title=f"{entity_id} IR snapshot",
                content=text[:20_000],
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=str(r.url),
                    raw_text=text[:20_000],
                    parsed_fields={"documentKind": "issuer_index", "discoveryOnly": True},
                ),
            ),
        ]
    finally:
        if rss_task and not rss_task.done():
            try:
                await rss_task
            except Exception as exc:
                LOGGER.debug("ir rss task failed entity=%s error=%s", entity_id, type(exc).__name__)


def poll_ir_page(entity_id: str, ir_url: str) -> Iterator[Event]:
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY, max_keepalive_connections=8)
    headers = {"User-Agent": USER_AGENT}

    async def _run() -> list[Event]:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=timeout, limits=limits
        ) as client:
            return await poll_ir_page_async(entity_id, ir_url, client)

    yield from asyncio.run(_run())


async def fetch_all_async() -> list[Event]:
    entities = [e for e in load_entities() if e.ir_url]
    rss_sources = _ir_source_by_entity(entities, load_sources())
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY, max_keepalive_connections=8)
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(
        headers=headers,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
    ) as client:
        batches = await asyncio.gather(
            *(
                poll_ir_page_async(
                    e.id,
                    str(e.ir_url),
                    client,
                    rss_source=rss_sources.get(e.id),
                )
                for e in entities
            )
        )
    return [event for batch in batches for event in batch]


def fetch_all() -> list[Event]:
    return asyncio.run(fetch_all_async())
