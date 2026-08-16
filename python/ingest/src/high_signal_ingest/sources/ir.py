"""IR (investor relations) page poller — checks IR pages for press releases."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Iterator

import httpx

from ..seed import load_entities
from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 ir-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 16


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
) -> list[Event]:
    """Fetch an IR landing page and extract a text snapshot."""
    try:
        r = await client.get(ir_url)
    except httpx.HTTPError as exc:
        LOGGER.debug("ir fetch failed entity=%s url=%s error=%s", entity_id, ir_url, exc)
        return []
    if r.status_code != 200:
        LOGGER.debug("ir fetch failed entity=%s url=%s status=%s", entity_id, ir_url, r.status_code)
        return []
    text = await asyncio.to_thread(_extract_ir_text, r.text)
    if not text:
        return []
    raw_hash = event_hash("ir", entity_id, ir_url, str(datetime.now(timezone.utc).date()))
    return [
        Event(
            id=raw_hash[:16],
            source=f"ir:{entity_id}",
            source_url=ir_url,
            published_at=datetime.now(timezone.utc),
            title=f"{entity_id} IR snapshot",
            content=text[:20_000],
            primary_entity_id=entity_id,
            raw_hash=raw_hash,
        )
    ]


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
            *(poll_ir_page_async(e.id, str(e.ir_url), client) for e in entities)
        )
    return [event for batch in batches for event in batch]


def fetch_all() -> list[Event]:
    return asyncio.run(fetch_all_async())
