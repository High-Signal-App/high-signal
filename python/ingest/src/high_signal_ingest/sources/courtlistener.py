"""CourtListener litigation adapter (free, key-less).

CourtListener (Free Law Project) exposes US federal + state court opinions over
a free, key-less REST API. Litigation is a primary-source signal for the tech /
finance domains: antitrust suits, IP / patent disputes, M&A challenges, and
data-center / siting appeals surface here before — or alongside — national
coverage, and case captions name the companies involved ("Brandt v. nVidia
Corp", "In Re Graphics Processing Units Antitrust Litigation"), so they map to
tracked entities.

Output: Events tagged `source: courtlistener`. Entity extraction runs
downstream against the case caption + nature-of-suit text. No key required.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 courtlistener-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://www.courtlistener.com/api/rest/v4/search/"
BASE = "https://www.courtlistener.com"

# Legal-topic searches scoped to the AI-infra / tech / finance thesis. The
# opinion search (`type=o`) is filtered to recently-filed matters per query.
# Tech/finance-specific legal topics. Broad terms ("data privacy", "data
# center") were dropped — they pulled unrelated municipal / FDA cases. The
# downstream entity gate drops any opinion that doesn't name a tracked company,
# so these queries aim for captions that will map (antitrust / IP / M&A).
QUERIES: tuple[str, ...] = (
    "semiconductor antitrust",
    "artificial intelligence patent",
    "export control chip",
    "patent infringement processor",
    "technology acquisition merger",
    "cloud computing antitrust",
    "trade secret software",
    "securities fraud technology",
    "data breach negligence",
    "artificial intelligence copyright",
)
PAGES = 2  # follow the `next` cursor this many times per query


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


def events_from_response(query: str, payload: dict[str, Any], since: datetime) -> list[Event]:
    rows = payload.get("results") if isinstance(payload.get("results"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        case_name = str(row.get("caseName") or row.get("caseNameFull") or "").strip()
        filed = _parse_date(str(row.get("dateFiled") or ""))
        path = str(row.get("absolute_url") or "").strip()
        if not case_name or filed is None or filed < since or not path:
            continue
        court = str(row.get("court") or "").strip()
        content = "\n".join(
            part
            for part in [
                f"Court: {court}" if court else "",
                f"Docket: {row.get('docketNumber')}" if row.get("docketNumber") else "",
                f"Nature of suit: {row.get('suitNature')}" if row.get("suitNature") else "",
                f"Status: {row.get('status')}" if row.get("status") else "",
                f"Query: {query}",
                "",
                case_name,
            ]
            if part != ""
        )
        raw_hash = _hash("courtlistener", path)
        out.append(
            Event(
                id=raw_hash[:16],
                source="courtlistener",
                source_url=f"{BASE}{path}",
                published_at=filed,
                title=f"Court opinion: {case_name}" + (f" ({court})" if court else ""),
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 30) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=25.0,
        follow_redirects=True,
    ) as client:
        for query in QUERIES:
            url: str | None = API_URL
            params: dict[str, object] | None = {
                "q": query,
                "type": "o",
                "order_by": "dateFiled desc",
                "filed_after": since.date().isoformat(),
            }
            for _ in range(PAGES):
                if not url:
                    break
                try:
                    resp = client.get(url, params=params)
                    resp.raise_for_status()
                    payload = resp.json()
                except (httpx.HTTPError, ValueError) as exc:
                    LOGGER.debug("courtlistener query=%s failed: %s", query, exc)
                    break
                if not isinstance(payload, dict):
                    break
                out.extend(events_from_response(query, payload, since))
                # `next` is an absolute URL carrying the cursor; params already baked in.
                url = payload.get("next")
                params = None
    return out
