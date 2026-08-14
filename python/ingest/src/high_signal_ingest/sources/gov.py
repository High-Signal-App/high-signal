"""Government & regulatory RSS adapter.

Free feeds only:
- US BIS export controls (Federal Register API)
- US CHIPS Act / Commerce announcements (commerce.gov RSS)
- FERC issuances (ferc.gov RSS)
- EU AI / Tech regulation (europa.eu)
- Taiwan MOEA, METI Japan, MIIT China — RSS where available

Output: Events tagged with `source: gov:<id>`. Spillover-heavy — entity
extraction runs downstream.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Iterator

import feedparser
import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 gov-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 8
RELEVANT_TERMS = (
    "ai",
    "artificial intelligence",
    "advanced computing",
    "antitrust",
    "autonomous",
    "broadband",
    "chip",
    "chips",
    "cloud",
    "cybersecurity",
    "data center",
    "datacenter",
    "digital",
    "drone",
    "export control",
    "foreign investment",
    "ftc",
    "gpu",
    "immigration",
    "machine learning",
    "merger",
    "model",
    "privacy",
    "semiconductor",
    "spectrum",
    "startup",
)

# Federal Register API filtered to BIS export-control rules
_BIS_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=industry-and-security-bureau"
    "&conditions[type][]=RULE&conditions[type][]=PRORULE&per_page=20"
)
_COMMERCE_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=commerce-department&per_page=20"
)
_FTC_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=federal-trade-commission&per_page=20"
)
_SEC_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=securities-and-exchange-commission&per_page=20"
)
_FCC_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=federal-communications-commission&per_page=20"
)
_DHS_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=homeland-security-department&per_page=20"
)
_FAA_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=federal-aviation-administration&per_page=20"
)
_FDA_FR = (
    "https://www.federalregister.gov/api/v1/documents.rss"
    "?conditions[agencies][]=food-and-drug-administration&per_page=20"
)


# (id, name, rss_url, default_entity_id)
DEFAULT_FEEDS: list[tuple[str, str, str, str | None]] = [
    # US
    ("us_bis", "US BIS export controls", _BIS_FR, None),
    ("us_commerce", "US Commerce announcements", _COMMERCE_FR, None),
    ("us_ftc", "US FTC rulemaking", _FTC_FR, None),
    ("us_sec", "US SEC rulemaking", _SEC_FR, None),
    ("us_fcc", "US FCC rulemaking", _FCC_FR, None),
    ("us_dhs", "US DHS / USCIS rulemaking", _DHS_FR, None),
    ("us_faa", "US FAA rulemaking", _FAA_FR, None),
    ("us_fda", "US FDA rulemaking", _FDA_FR, None),
    (
        "ferc_news",
        "FERC news",
        "https://www.ferc.gov/news-events/news/news-releases.xml",
        None,
    ),
    # EU
    (
        "eu_ai_news",
        "European Commission digital",
        "https://digital-strategy.ec.europa.eu/en/news.xml",
        None,
    ),
    # India — PIB has structured RSS
    (
        "india_meity",
        "India MeitY (PIB releases)",
        "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
        None,
    ),
    (
        "india_dpiit",
        "India DPIIT / MoCI semiconductor",
        "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=12",
        None,
    ),
    # Japan — METI press releases (English)
    (
        "japan_meti",
        "Japan METI press",
        "https://www.meti.go.jp/english/press/index.html",
        None,
    ),
    # Taiwan — MOEA & focus taiwan tech (Atom/RSS)
    (
        "taiwan_focus_tech",
        "Focus Taiwan — Tech",
        "https://focustaiwan.tw/rss/aTECH.xml",
        None,
    ),
    # Korea — Yonhap business RSS (English)
    (
        "korea_yonhap_biz",
        "Yonhap — Business",
        "https://en.yna.co.kr/RSS/economy.xml",
        None,
    ),
    # UK / global tech regulator
    (
        "uk_cma",
        "UK CMA news",
        "https://www.gov.uk/government/organisations/competition-and-markets-authority.atom",
        None,
    ),
]


def _is_relevant(title: str, body: str) -> bool:
    text = f"{title} {body}".lower()
    for term in RELEVANT_TERMS:
        if len(term) <= 3:
            if re.search(rf"\b{re.escape(term)}\b", text):
                return True
        elif term in text:
            return True
    return False


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            return ""
        return r.text
    except httpx.HTTPError:
        return ""


async def fetch_feed_async(
    fid: str,
    name: str,
    url: str,
    entity_id: str | None,
    since: datetime,
    client: httpx.AsyncClient,
) -> list[Event]:
    xml = await _fetch_text(client, url)
    if not xml:
        return []
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries[:25]:
        link = (entry.get("link") or "").strip()
        if not link:
            continue
        title = (entry.get("title") or "").strip()
        body = (entry.get("summary") or entry.get("description") or "").strip()
        published = entry.get("published") or entry.get("updated") or ""
        try:
            from email.utils import parsedate_to_datetime

            pub = parsedate_to_datetime(published) if published else None
            if pub is None or pub.tzinfo is None:
                pub = (pub or datetime.now(timezone.utc)).replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if pub < since:
            continue
        if not _is_relevant(title, body):
            continue
        raw_hash = event_hash("gov", fid, link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"gov:{fid}",
                source_url=link,
                published_at=pub,
                title=f"{name}: {title}" if title else name,
                content=body[:20_000] or None,
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_all_async(
    days: int = 3,
    feeds: list[tuple[str, str, str, str | None]] | None = None,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": USER_AGENT}
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        batches = await asyncio.gather(
            *(
                fetch_feed_async(fid, name, url, eid, since, client)
                for fid, name, url, eid in (feeds or DEFAULT_FEEDS)
            )
        )
    return [event for batch in batches for event in batch]


def fetch_all(
    days: int = 3, feeds: list[tuple[str, str, str, str | None]] | None = None
) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, feeds=feeds))


def fetch_feed(
    fid: str, name: str, url: str, entity_id: str | None, days: int = 3
) -> Iterator[Event]:
    yield from fetch_all(days=days, feeds=[(fid, name, url, entity_id)])
