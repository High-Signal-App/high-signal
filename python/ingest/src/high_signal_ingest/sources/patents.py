"""USPTO PatentsView adapter.

Public, no-key patent grants/applications for a curated set of AI/startup
assignees. Patents are long-horizon product-lookahead evidence, not short-term
market signals by themselves.

After the 2026 USPTO ODP migration, the legacy endpoint redirects to the
transition guide. This adapter is retained as an explicit compatibility probe,
returns no events non-fatally, and is excluded from automatic runs. Reopen only
after an account-backed ODP source has enough expected yield to justify its
MFA, profile, API-key, and secret-management overhead.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 patents-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://api.patentsview.org/patents/query"


@dataclass(frozen=True)
class PatentAssignee:
    name: str
    entity_id: str


ASSIGNEES = [
    PatentAssignee("NVIDIA", "NVDA"),
    PatentAssignee("Microsoft", "MSFT"),
    PatentAssignee("OpenAI", "OPENAI"),
    PatentAssignee("Anthropic", "ANTHROPIC"),
    PatentAssignee("Databricks", "DATABRICKS"),
]


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def events_from_response(
    assignee: PatentAssignee, payload: dict[str, Any], since: datetime
) -> list[Event]:
    patents = payload.get("patents") if isinstance(payload.get("patents"), list) else []
    out: list[Event] = []
    for patent in patents:
        if not isinstance(patent, dict):
            continue
        number = str(patent.get("patent_number") or "").strip()
        title = str(patent.get("patent_title") or "").strip()
        published = _parse_date(str(patent.get("patent_date") or ""))
        if not number or published is None or published < since:
            continue
        abstract = str(patent.get("patent_abstract") or "").strip()
        raw_hash = event_hash("patentsview", assignee.name, number)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"patents:{assignee.entity_id.lower()}",
                source_url=f"https://patents.google.com/patent/US{number}",
                published_at=published,
                title=f"Patent grant: {assignee.name} - {title or number}",
                content=abstract[:20_000] or None,
                primary_entity_id=assignee.entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 365, assignees: list[PatentAssignee] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for assignee in assignees or ASSIGNEES:
            query = {
                "_and": [
                    {"_gte": {"patent_date": since.date().isoformat()}},
                    {"assignee_organization": assignee.name},
                ]
            }
            fields = ["patent_number", "patent_title", "patent_date", "patent_abstract"]
            try:
                response = client.get(
                    API_URL,
                    params={
                        "q": json.dumps(query),
                        "f": json.dumps(fields),
                        "o": json.dumps({"per_page": 25}),
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("patents fetch failed assignee=%s error=%s", assignee.name, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(assignee, payload, since))
    return out
