"""GDELT 2.0 DOC adapter — global news event graph, free, no auth.

GDELT indexes broadcast/print/web news from every country in 65+ languages
since 2015 and tags entities, themes, and tone. The DOC API provides a
date-bounded query interface returning matching articles with title/url/seen-at.

Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
Endpoint: https://api.gdeltproject.org/api/v2/doc/doc

Use cases here:
- Pull all AI-infra related articles globally for backfill
- Filter by theme (e.g. SEMICONDUCTORS, TECH_INDUSTRY) + org code
- Date range bounded — perfect for replaying any historical window
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 gdelt-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 4
GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc"


# Per-entity / per-theme single-keyword queries.
# GDELT's OR-grouping with parens times out for big lists in our experiments;
# single-keyword queries are reliable and cheap to fan out concurrently.
# Tuple = (query_id, query_text, primary_entity_id_or_None)
# When entity_id is provided, every event from that query is auto-anchored to
# the entity — bypasses gazetteer match against title-only GDELT bodies.
DEFAULT_QUERIES: list[tuple[str, str, str | None]] = [
    ("nvda", "NVIDIA", "NVDA"),
    ("amd", "AMD", "AMD"),
    ("tsmc", "TSMC", "TSM"),
    ("asml", "ASML", "ASML"),
    ("intel", "Intel", "INTC"),
    ("samsung", "Samsung Electronics", "SAMSUNG"),
    ("sk_hynix", "SK Hynix", "SK_HYNIX"),
    ("micron", "Micron", "MU"),
    ("broadcom", "Broadcom", "AVGO"),
    ("marvell", "Marvell Technology", "MRVL"),
    ("arm", "Arm Holdings", "ARM"),
    ("qualcomm", "Qualcomm", "QCOM"),
    ("amat", "Applied Materials", "AMAT"),
    ("lrcx", "Lam Research", "LRCX"),
    ("klac", "KLA Corporation", "KLAC"),
    ("tokyo_electron", "Tokyo Electron", "TEL"),
    ("smic", "SMIC", "SMIC"),
    ("rapidus", "Rapidus", "RAPIDUS"),
    ("super_micro", "Supermicro", "SMCI"),
    ("anet", "Arista Networks", "ANET"),
    ("vertiv", "Vertiv", "VRT"),
    ("constellation", "Constellation Energy", "CEG"),
    ("vistra", "Vistra", "VST"),
    ("talen", "Talen Energy", "TLN"),
    ("ge_vernova", "GE Vernova", "GEV"),
    ("eaton", "Eaton", "ETN"),
    ("coreweave", "CoreWeave", "CRWV"),
    ("nebius", "Nebius", "NBIS"),
    ("openai", "OpenAI", "OPENAI"),
    ("anthropic", "Anthropic", "ANTHROPIC"),
    ("xai", "xAI", "XAI"),
    # Theme queries — no anchor entity; LLM/gazetteer extracts downstream.
    ("hbm", "HBM3e", None),
    ("euv", "EUV lithography", None),
    ("cowos", "CoWoS", None),
    ("export_control", "chip export control", None),
    ("entity_list", "entity list", None),
    ("ai_capex", "AI capex", None),
    ("stargate", "Stargate", None),
]

# Country codes that move AI-infra markets — matches GDELT 2-letter FIPS
TOP_COUNTRIES = ["US", "TW", "KR", "JP", "CH", "HK", "NL", "DE", "UK", "IN", "FR", "IL", "SG"]


def _gdelt_dt(d: datetime) -> str:
    """GDELT expects YYYYMMDDhhmmss in UTC."""
    return d.astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")


def _query_sync(
    client: httpx.Client,
    name: str,
    query: str,
    since: datetime,
    until: datetime,
    max_records: int = 250,
    entity_id: str | None = None,
) -> list[Event]:
    """GDELT's async TLS handshake fails via httpx; sync works fine. We trade
    parallelism for reliability — total fan-out time is OK because each call is
    sub-second.

    `entity_id`: when set, every event from this query is anchored to that
    entity (bypasses gazetteer match against title-only GDELT bodies).
    """
    params = {
        "query": query,
        "mode": "ArtList",
        "format": "JSON",
        "maxrecords": str(max_records),
        "startdatetime": _gdelt_dt(since),
        "enddatetime": _gdelt_dt(until),
        "sort": "DateDesc",
    }
    try:
        r = client.get(GDELT_BASE, params=params)
    except httpx.HTTPError as exc:
        LOGGER.debug("gdelt fetch failed q=%s error=%s", name, exc)
        return []
    if r.status_code != 200:
        LOGGER.debug("gdelt status q=%s code=%s body=%s", name, r.status_code, r.text[:200])
        return []
    try:
        data = r.json()
    except ValueError:
        return []
    out: list[Event] = []
    for item in data.get("articles", []):
        link = (item.get("url") or "").strip()
        if not link:
            continue
        title = (item.get("title") or "").strip()
        seenstr = item.get("seendate") or ""
        try:
            pub = datetime.strptime(seenstr, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if pub < since or pub > until:
            continue
        country = item.get("sourcecountry")
        domain = item.get("domain")
        raw_hash = event_hash("gdelt", name, link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"gdelt:{name}",
                source_url=link,
                published_at=pub,
                title=f"[{country}/{domain}] {title}" if country else title,
                content=None,
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_range(
    since: datetime,
    until: datetime | None = None,
    queries: list[tuple[str, str, str | None]] | None = None,
    max_records_per_query: int = 250,
) -> list[Event]:
    if until is None:
        until = datetime.now(timezone.utc)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=30.0,
    ) as client:
        for name, q, eid in queries or DEFAULT_QUERIES:
            out.extend(
                _query_sync(client, name, q, since, until, max_records_per_query, entity_id=eid),
            )
    return out


async def fetch_range_async(
    since: datetime,
    until: datetime | None = None,
    queries: list[tuple[str, str, str | None]] | None = None,
    max_records_per_query: int = 250,
) -> list[Event]:
    """Kept for symmetry with other adapters; runs sync work in a thread."""
    return await asyncio.to_thread(fetch_range, since, until, queries, max_records_per_query)


def fetch_all(
    days: int = 1,
    queries: list[tuple[str, str, str | None]] | None = None,
    max_records_per_query: int = 250,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return fetch_range(since, queries=queries, max_records_per_query=max_records_per_query)
