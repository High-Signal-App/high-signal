"""OpenStates state-legislature adapter (free key; skipped without one).

OpenStates exposes bills from all 50 US state legislatures over a free API
(register for a key at openstates.org). State law is the missing middle between
federal policy (`gov`) and municipal land-use (`legistar`): AI regulation,
data-center tax incentives, and energy-siting rules are largely decided at the
state level, in the data-center / fab corridors the brief tracks.

Requires ``OPENSTATES_API_KEY``. The source is skipped without a key so daily
ingest stays green. Like municipal records, state bills are mostly entity-less
policy text — they serve as corroboration / thematic context for the technology
and finance domains, not as standalone entity signals.

Output: Events tagged `source: openstates`.
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 openstates-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://v3.openstates.org/bills"


@dataclass(frozen=True)
class StateQuery:
    jurisdiction: str
    search_term: str


# Data-center / fab / AI-policy corridors × thesis topics. Kept small to respect
# the OpenStates free-tier rate limit.
QUERIES: tuple[StateQuery, ...] = (
    StateQuery("Virginia", "data center"),
    StateQuery("Texas", "data center"),
    StateQuery("Ohio", "data center"),
    StateQuery("Arizona", "data center"),
    StateQuery("Georgia", "data center"),
    StateQuery("Oregon", "data center"),
    StateQuery("Indiana", "data center"),
    StateQuery("California", "artificial intelligence"),
    StateQuery("New York", "artificial intelligence"),
    StateQuery("Texas", "semiconductor"),
    StateQuery("Arizona", "semiconductor"),
    StateQuery("Virginia", "electricity"),
)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value[:19].replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def events_from_response(query: StateQuery, payload: dict[str, Any], since: datetime) -> list[Event]:
    rows = payload.get("results") if isinstance(payload.get("results"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        identifier = str(row.get("identifier") or "").strip()
        title = str(row.get("title") or "").strip()
        url = str(row.get("openstates_url") or "").strip()
        action = _parse_date(str(row.get("latest_action_date") or ""))
        if not identifier or not title or url == "" or action is None or action < since:
            continue
        juris = ""
        if isinstance(row.get("jurisdiction"), dict):
            juris = str(row["jurisdiction"].get("name") or "").strip()
        juris = juris or query.jurisdiction
        content = "\n".join(
            part
            for part in [
                f"Jurisdiction: {juris}",
                f"Bill: {identifier}",
                f"Latest action: {row.get('latest_action_description')}"
                if row.get("latest_action_description")
                else "",
                f"Query: {query.search_term}",
                "",
                title,
            ]
            if part != ""
        )
        raw_hash = _hash("openstates", url)
        out.append(
            Event(
                id=raw_hash[:16],
                source="openstates",
                source_url=url,
                published_at=action,
                title=f"{juris} bill {identifier}: {title}"[:300],
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 30, api_key: str | None = None) -> list[Event]:
    key = api_key or os.environ.get("OPENSTATES_API_KEY")
    if not key:
        LOGGER.debug("openstates skipped: OPENSTATES_API_KEY is not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json", "X-API-Key": key},
        timeout=25.0,
        follow_redirects=True,
    ) as client:
        for query in QUERIES:
            try:
                resp = client.get(
                    API_URL,
                    params={
                        "jurisdiction": query.jurisdiction,
                        "q": query.search_term,
                        "sort": "latest_action_desc",
                        "per_page": 10,
                    },
                )
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug(
                    "openstates query=%s/%s failed: %s",
                    query.jurisdiction,
                    query.search_term,
                    exc,
                )
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(query, payload, since))
    return out
