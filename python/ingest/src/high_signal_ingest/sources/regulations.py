"""Regulations.gov API adapter.

Requires ``REGULATIONS_GOV_API_KEY``. The source is skipped without a key so
daily ingest remains green. Regulations.gov is a policy-primary source for
dockets and comments that matter after the Federal Register notice appears.
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


USER_AGENT = "high-signal/0.1 regulations-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://api.regulations.gov/v4/documents"


@dataclass(frozen=True)
class RegulationQuery:
    search_term: str
    entity_id: str | None = None


QUERIES = [
    RegulationQuery("artificial intelligence"),
    RegulationQuery("semiconductor"),
    RegulationQuery("data center"),
    RegulationQuery("cybersecurity"),
    RegulationQuery("export controls"),
]


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    for candidate in (value, value[:10]):
        try:
            parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            return (
                parsed.astimezone(timezone.utc)
                if parsed.tzinfo
                else parsed.replace(tzinfo=timezone.utc)
            )
        except ValueError:
            continue
    return None


def events_from_response(
    query: RegulationQuery, payload: dict[str, Any], since: datetime
) -> list[Event]:
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        attributes = row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
        document_id = str(row.get("id") or attributes.get("documentId") or "").strip()
        title = str(attributes.get("title") or "").strip()
        posted = _parse_datetime(
            str(attributes.get("postedDate") or attributes.get("frDocNum") or "")
        )
        if not document_id or not title or posted is None or posted < since:
            continue
        raw_hash = event_hash("regulations", query.search_term, document_id)
        content = "\n".join(
            part
            for part in [
                f"Query: {query.search_term}",
                f"Agency: {attributes.get('agencyId')}" if attributes.get("agencyId") else "",
                f"Type: {attributes.get('documentType')}" if attributes.get("documentType") else "",
                f"Docket: {attributes.get('docketId')}" if attributes.get("docketId") else "",
                f"Comment end: {attributes.get('commentEndDate')}"
                if attributes.get("commentEndDate")
                else "",
            ]
            if part
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source="regulations-gov",
                source_url=f"https://www.regulations.gov/document/{document_id}",
                published_at=posted,
                title=f"Regulations.gov document: {title}",
                content=content[:20_000] or None,
                primary_entity_id=query.entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 30, api_key: str | None = None) -> list[Event]:
    key = api_key or os.environ.get("REGULATIONS_GOV_API_KEY")
    if not key:
        LOGGER.debug("regulations.gov skipped: REGULATIONS_GOV_API_KEY is not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for query in QUERIES:
            try:
                response = client.get(
                    API_URL,
                    params={
                        "api_key": key,
                        "filter[searchTerm]": query.search_term,
                        "filter[postedDate][ge]": since.date().isoformat(),
                        "page[size]": 25,
                        "sort": "-postedDate",
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug(
                    "regulations.gov fetch failed query=%s error=%s", query.search_term, exc
                )
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(query, payload, since))
    return out
