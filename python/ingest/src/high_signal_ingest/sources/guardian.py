"""Guardian Open Platform adapter.

Requires ``GUARDIAN_API_KEY``. Without a key this source returns no events so
daily ingest remains green. Guardian is a corroboration/full-text news source,
not a unique primary evidence source.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 guardian-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://content.guardianapis.com/search"
QUERIES = [
    "artificial intelligence OR AI",
    "semiconductor OR chips",
    "data center OR datacenter",
    "startup funding",
]


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (
            parsed.astimezone(timezone.utc)
            if parsed.tzinfo
            else parsed.replace(tzinfo=timezone.utc)
        )
    except ValueError:
        return None


def events_from_response(query: str, payload: dict[str, Any], since: datetime) -> list[Event]:
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}
    rows = response.get("results") if isinstance(response.get("results"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("webUrl") or "").strip()
        published = _parse_datetime(str(row.get("webPublicationDate") or ""))
        if not url or published is None or published < since:
            continue
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        body = str(fields.get("bodyText") or fields.get("trailText") or "").strip()
        raw_hash = event_hash("guardian", query, url)
        out.append(
            Event(
                id=raw_hash[:16],
                source="guardian",
                source_url=url,
                published_at=published,
                title=str(row.get("webTitle") or "").strip() or None,
                content=body[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 7, api_key: str | None = None) -> list[Event]:
    key = api_key or os.environ.get("GUARDIAN_API_KEY")
    if not key:
        LOGGER.debug("guardian skipped: GUARDIAN_API_KEY is not set")
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
                        "api-key": key,
                        "q": query,
                        "from-date": since.date().isoformat(),
                        "order-by": "newest",
                        "show-fields": "trailText,bodyText",
                        "page-size": 25,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("guardian fetch failed query=%s error=%s", query, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(query, payload, since))
    return out
