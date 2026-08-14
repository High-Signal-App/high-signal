"""Companies House API adapter.

Requires ``COMPANIES_HOUSE_API_KEY``. This is a UK entity-enrichment source for
tracked companies, not a daily public signal source.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from ..seed import load_entities
from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 companies-house-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://api.company-information.service.gov.uk/search/companies"


def event_from_search_item(entity_id: str, query: str, item: dict[str, Any]) -> Event | None:
    company_number = str(item.get("company_number") or "").strip()
    title = str(item.get("title") or "").strip()
    if not company_number or not title:
        return None
    status = str(item.get("company_status") or "").strip()
    company_type = str(item.get("company_type") or "").strip()
    address = item.get("address_snippet")
    raw_hash = event_hash("companies-house", entity_id, company_number)
    content = "\n".join(
        part
        for part in [
            f"Query: {query}",
            f"Status: {status}" if status else "",
            f"Type: {company_type}" if company_type else "",
            f"Address: {address}" if address else "",
        ]
        if part
    )
    return Event(
        id=raw_hash[:16],
        source="companies-house",
        source_url=f"https://find-and-update.company-information.service.gov.uk/company/{company_number}",
        published_at=datetime.now(timezone.utc),
        title=f"Companies House enrichment: {title}",
        content=content[:20_000] or None,
        primary_entity_id=entity_id,
        raw_hash=raw_hash,
    )


def fetch_all(days: int = 30, api_key: str | None = None, limit: int = 50) -> list[Event]:
    _ = days
    key = api_key or os.environ.get("COMPANIES_HOUSE_API_KEY")
    if not key:
        LOGGER.debug("companies house skipped: COMPANIES_HOUSE_API_KEY is not set")
        return []
    out: list[Event] = []
    entities = [entity for entity in load_entities() if entity.country == "UK"][:limit]
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        auth=(key, ""),
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for entity in entities:
            try:
                response = client.get(
                    API_URL,
                    params={"q": entity.name, "items_per_page": 1},
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("companies house fetch failed entity=%s error=%s", entity.id, exc)
                continue
            items = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(items, list) or not items:
                continue
            first = items[0]
            if isinstance(first, dict):
                event = event_from_search_item(entity.id, entity.name, first)
                if event:
                    out.append(event)
    return out
