"""Municipal legislative records adapter (Legistar / Granicus Web API).

This is the GatherGov-style source: US city & county councils publish their
agendas, minutes, ordinances and resolutions through Legistar, the agenda-
management system Granicus sells to ~70% of the largest US municipalities.
Legistar exposes every *public* record over a free, key-less HTTPS+JSON API
(`https://webapi.legistar.com/v1/<client>/...`), so this is an aggregatable
substitute for scraping hundreds of individual city portals.

Why it matters to High Signal: municipal land-use is a leading indicator for
the AI-infra / semiconductor thesis. Data-center conditional-use permits,
substation and power-purchase approvals, fab rezonings and economic-development
agreements show up in council `Matters` *before* they reach national news. We
keyword-filter each city's recent `Matters` to development / energy / tech
land-use items and drop procedural noise (minutes-approvals, communications).

Output: Events tagged `source: legistar:<client>`. Spillover / entity
extraction runs downstream. No API key required; cities that require a token
(e.g. NYC) return 4xx/5xx and are skipped silently so daily ingest stays green.

Smaller municipalities that GatherGov also covers run on CivicPlus / PrimeGov /
eScribe rather than Legistar; those are separate adapters if/when we add them.
See PROJECT_STATUS.md for the municipal-source landscape.
"""

from __future__ import annotations

import asyncio
import re
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Iterator

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 legistar-ingest"
LOGGER = logging.getLogger(__name__)
API_ROOT = "https://webapi.legistar.com/v1"
DEFAULT_CONCURRENCY = 4  # polite: every client shares the one webapi host
MATTERS_PER_CLIENT = 300

# (client_code, display_name) — confirmed key-less Legistar municipalities,
# biased toward data-center / semiconductor / tech land-use corridors.
# Override the whole set via LEGISTAR_CLIENTS="phoenix:Phoenix AZ,mesa:Mesa AZ".
DEFAULT_CLIENTS: list[tuple[str, str]] = [
    # Data-center / fab corridors verified reachable on the free Legistar API.
    ("phoenix", "Phoenix AZ"),
    ("mesa", "Mesa AZ"),
    ("goodyear", "Goodyear AZ"),         # West Valley data-center growth
    ("maricopa", "Maricopa County AZ"),  # county-level zoning for greater Phoenix
    ("sanjose", "San Jose CA"),
    ("santaclara", "Santa Clara CA"),
    ("sanantonio", "San Antonio TX"),    # Microsoft / Google data centers
    ("columbus", "Columbus OH"),         # Intel fab metro + hyperscaler builds
    ("atlantaga", "Atlanta GA"),         # Southeast data-center hub
    ("mecklenburg", "Mecklenburg County NC"),  # Charlotte metro
    ("racine", "Racine County WI"),      # Microsoft Mount Pleasant campus
    # Broader tech metros (verified reachable on the free API).
    ("seattle", "Seattle WA"),
    ("denver", "Denver CO"),
    ("nashville", "Nashville TN"),
    ("pittsburgh", "Pittsburgh PA"),
    ("kansascity", "Kansas City MO"),
    ("milwaukee", "Milwaukee WI"),
    ("stpaul", "St. Paul MN"),
    ("oakland", "Oakland CA"),
    ("sacramento", "Sacramento CA"),
    ("longbeach", "Long Beach CA"),
    ("mountainview", "Mountain View CA"),
    ("madison", "Madison WI"),
    ("a2gov", "Ann Arbor MI"),
    ("chicago", "Chicago IL"),
]

# High-specificity land-use / energy / tech terms. Multi-word where possible so
# bare procedural rows ("zoning minutes") don't dominate; `_is_relevant` still
# filters out procedural MatterTypes below.
RELEVANT_TERMS = (
    "data center",
    "data centre",
    "datacenter",
    "data center campus",
    "hyperscale",
    "colocation",
    "rezon",            # rezone / rezoning
    "conditional use",
    "conditional use permit",
    "special use",
    "special exception",
    "comprehensive plan amendment",
    "development agreement",
    "planned development",
    "general plan amendment",
    "site plan",
    "subdivision",
    "annexation",
    "semiconductor",
    "gigafactory",
    "economic development",
    "tax increment",
    "power purchase",
    "substation",
    "megawatt",
    "transmission line",
    "fiber optic",
    "dark fiber",
    "broadband",
    "battery storage",
    "solar farm",
)
_RELEVANT_RE = re.compile("|".join(re.escape(t) for t in RELEVANT_TERMS))

# Procedural MatterTypes that match a keyword but carry no new signal. Kept
# narrow: a bare consent-agenda wrapper never passes RELEVANT_TERMS anyway, and
# excluding "consent agenda" would drop real items (e.g. San Jose types its
# rezonings as "Land Use Consent Agenda").
_PROCEDURAL_TYPES = (
    "minutes",
    "communication",
)


def _clients_from_env() -> list[tuple[str, str]]:
    raw = os.environ.get("LEGISTAR_CLIENTS", "").strip()
    if not raw:
        return DEFAULT_CLIENTS
    out: list[tuple[str, str]] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        code, _, name = chunk.partition(":")
        code = code.strip()
        if code:
            out.append((code, (name.strip() or code)))
    return out or DEFAULT_CLIENTS


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    for candidate in (value, value[:19], value[:10]):
        try:
            parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            continue
    return None


def _is_relevant(matter: dict) -> bool:
    type_name = str(matter.get("MatterTypeName") or "").lower()
    if any(p in type_name for p in _PROCEDURAL_TYPES):
        return False
    text = f"{matter.get('MatterTitle') or ''} {matter.get('MatterName') or ''}".lower()
    return _RELEVANT_RE.search(text) is not None


def events_from_matters(
    code: str, name: str, matters: list[dict], since: datetime
) -> list[Event]:
    out: list[Event] = []
    for matter in matters:
        if not isinstance(matter, dict) or not _is_relevant(matter):
            continue
        matter_id = matter.get("MatterId")
        if matter_id is None:
            continue
        intro = _parse_datetime(matter.get("MatterIntroDate"))
        agenda = _parse_datetime(matter.get("MatterAgendaDate"))
        published = intro or agenda
        if published is None or published < since:
            continue
        title = str(matter.get("MatterTitle") or matter.get("MatterName") or "").strip()
        if not title:
            continue
        body = str(matter.get("MatterBodyName") or "").strip()
        guid = str(matter.get("MatterGuid") or "").strip()
        url = (
            f"https://{code}.legistar.com/LegislationDetail.aspx?ID={matter_id}"
            + (f"&GUID={guid}" if guid else "")
        )
        content = "\n".join(
            part
            for part in [
                f"File: {matter.get('MatterFile')}" if matter.get("MatterFile") else "",
                f"Type: {matter.get('MatterTypeName')}" if matter.get("MatterTypeName") else "",
                f"Status: {matter.get('MatterStatusName')}" if matter.get("MatterStatusName") else "",
                f"Body: {body}" if body else "",
                f"Introduced: {intro.date().isoformat()}" if intro else "",
                f"Agenda date: {agenda.date().isoformat()}" if agenda else "",
                "",
                title,
            ]
            if part != ""
        )
        raw_hash = event_hash("legistar", code, str(matter_id))
        prefix = f"{name} — {body}" if body else name
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"legistar:{code}",
                source_url=url,
                published_at=published,
                title=f"{prefix}: {title}"[:300],
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_client_async(
    code: str, name: str, since: datetime, client: httpx.AsyncClient
) -> list[Event]:
    # OData v3 datetime literal; intro-date window keeps the payload bounded.
    params = {
        "$filter": f"MatterIntroDate ge datetime'{since.date().isoformat()}'",
        "$orderby": "MatterIntroDate desc",
        "$top": str(MATTERS_PER_CLIENT),
    }
    try:
        resp = await client.get(f"{API_ROOT}/{code}/Matters", params=params)
        if resp.status_code != 200:
            LOGGER.debug("legistar %s skipped: HTTP %s", code, resp.status_code)
            return []
        payload = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("legistar %s fetch failed: %s", code, exc)
        return []
    if not isinstance(payload, list):
        return []
    return events_from_matters(code, name, payload, since)


async def fetch_all_async(
    days: int = 30, clients: list[tuple[str, str]] | None = None
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    timeout = httpx.Timeout(25.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        batches = await asyncio.gather(
            *(
                fetch_client_async(code, name, since, client)
                for code, name in (clients or _clients_from_env())
            )
        )
    return [event for batch in batches for event in batch]


def fetch_all(
    days: int = 30, clients: list[tuple[str, str]] | None = None
) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, clients=clients))


def fetch_client(code: str, name: str, days: int = 30) -> Iterator[Event]:
    yield from fetch_all(days=days, clients=[(code, name)])
