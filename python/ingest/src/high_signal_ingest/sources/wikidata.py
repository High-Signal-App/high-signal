"""Wikidata entity enrichment adapter.

This is an enrichment source. It emits bounded, mapped events for seed entities
whose Wikidata search result can improve canonical names, descriptions, and
sector/entity-resolution work.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from ..seed import load_entities
from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 wikidata-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://www.wikidata.org/w/api.php"


def event_from_search_result(entity_id: str, query: str, result: dict[str, Any]) -> Event | None:
    qid = str(result.get("id") or "").strip()
    label = str(result.get("label") or "").strip()
    description = str(result.get("description") or "").strip()
    concepturi = str(result.get("concepturi") or f"https://www.wikidata.org/wiki/{qid}").strip()
    if not qid:
        return None
    raw_hash = event_hash("wikidata", entity_id, qid)
    return Event(
        id=raw_hash[:16],
        source="wikidata",
        source_url=concepturi,
        published_at=datetime.now(timezone.utc),
        title=f"Wikidata enrichment: {query} -> {label or qid}",
        content=description or None,
        primary_entity_id=entity_id,
        raw_hash=raw_hash,
    )


def fetch_all(days: int = 30, limit: int = 50) -> list[Event]:
    _ = days
    out: list[Event] = []
    entities = load_entities()[:limit]
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for entity in entities:
            try:
                response = client.get(
                    API_URL,
                    params={
                        "action": "wbsearchentities",
                        "format": "json",
                        "language": "en",
                        "limit": 1,
                        "search": entity.name,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("wikidata fetch failed entity=%s error=%s", entity.id, exc)
                continue
            search = payload.get("search") if isinstance(payload, dict) else None
            if not isinstance(search, list) or not search:
                continue
            first = search[0]
            if isinstance(first, dict):
                event = event_from_search_result(entity.id, entity.name, first)
                if event:
                    out.append(event)
    return out
