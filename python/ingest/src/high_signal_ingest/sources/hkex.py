"""HKEXnews adapter — Hong Kong-listed corporate filings, English, free.

Covers SMIC (981), Hua Hong (1347), BABA (9988), Tencent (700), BIDU (9888)
plus other HK-listed Chinese tech. Backfillable via the "Headlines" search.

Docs are sparse; we use the JSON-backed today / by-date endpoints:
  https://www1.hkexnews.hk/ncms/script/eng/announcement.json (today's full-day)
  https://www.hkexnews.hk/ncms/script/eng/listed/<date>/announcement_lc.json

We also support the per-issuer search to pull historical filings for a known
stock code. The pipeline maps hkex_code → entity_id via metadata.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterator

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 hkex-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 4

# (hkex_code, entity_id) — extend as needed
TRACKED_ISSUERS: list[tuple[str, str]] = [
    ("00981", "SMIC"),
    ("01347", "HHGRACE"),
    ("09988", "BABA"),
    ("00700", "TCEHY"),
    ("09888", "BIDU"),
    ("01810", "XIAOMI"),
    ("09618", "JD"),
    ("01024", "KUAISHOU"),
]

# Material-disclosure types that carry signal
SIGNAL_TYPES = {
    "ANNOUNCEMENTS",
    "CIRCULAR",
    "FINANCIAL STATEMENTS / ESG INFORMATION",
    "PROFIT WARNING / OTHER WARNING",
    "INSIDE INFORMATION",
    "MATERIAL TRANSACTIONS",
}

LISTED_FEED = "https://www1.hkexnews.hk/listedco/listconews/sehk/{date}/{idx}.htm"


async def _fetch_day_async(client: httpx.AsyncClient, day: datetime) -> list[Event]:
    """HKEXnews exposes a daily list per stock; we pull the issuer-search JSON."""
    out: list[Event] = []
    date_str = day.strftime("%Y%m%d")
    for code, entity_id in TRACKED_ISSUERS:
        # Per-issuer search — historical search returns titles + filing URLs
        # https://di.hkex.com.hk/di/summary/SearchAnnouncements.aspx
        # Fallback: use today's-news JSON for current-day fetches
        url = (
            "https://www1.hkexnews.hk/search/titlesearch.xhtml"
            f"?app=annpubgemccaprev&search_text=&stock_id={code}"
            f"&from_date={date_str}&to_date={date_str}"
        )
        try:
            r = await client.get(url)
        except httpx.HTTPError as exc:
            LOGGER.debug("hkex fetch failed code=%s error=%s", code, exc)
            continue
        if r.status_code != 200:
            continue
        # Parse minimal result set — the page is HTML; titles + filing PDF links.
        # For v0 we just record one snapshot per issuer per day if the page has content.
        if "No. of records" in r.text and "0\xa0" in r.text:
            continue
        title = f"HKEX filings — {entity_id} ({code}) {date_str}"
        raw_hash = event_hash("hkex", code, date_str)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"hkex:{code}",
                source_url=url,
                published_at=day.replace(hour=12, tzinfo=timezone.utc),
                title=title,
                content=r.text[:20_000],
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_range_async(since: datetime, until: datetime | None = None) -> list[Event]:
    if until is None:
        until = datetime.now(timezone.utc)
    headers = {"User-Agent": USER_AGENT}
    timeout = httpx.Timeout(30.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)

    days: list[datetime] = []
    cur = since
    while cur <= until:
        if cur.weekday() < 5:  # skip weekends — HK exchange closed
            days.append(cur)
        cur += timedelta(days=1)
        if len(days) > 60:
            break  # cap a single backfill run

    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        batches = await asyncio.gather(*(_fetch_day_async(client, d) for d in days))
    return [event for batch in batches for event in batch]


def fetch_all(days: int = 1) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return asyncio.run(fetch_range_async(since))


def fetch_range(since: datetime, until: datetime | None = None) -> Iterator[Event]:
    yield from asyncio.run(fetch_range_async(since, until))
