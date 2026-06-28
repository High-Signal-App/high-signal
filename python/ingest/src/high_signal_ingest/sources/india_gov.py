"""India government & regulator adapter.

Covers India-specific public sources — securities regulator, central bank,
stock-exchange corporate announcements, mutual-fund NAVs, official statistics,
and UPI payment rails. All keyless except `data.gov.in` (free
`DATA_GOV_IN_API_KEY`).

Sub-sources:
- sebi              — SEBI RSS (press releases, circulars, orders)
- rbi               — Reserve Bank of India RSS (press releases)
- bse-announcements — BSE India corporate announcements (XML/RSS)
- nse-announcements — NSE India corporate announcements (JSON API)
- amfi              — AMFI mutual-fund NAVs via mfapi.in (JSON API)
- mospi             — MOSPI eSankhyiki CPI/IIP (JSON API, keyless-limited)
- upi-npci           — NPCI UPI monthly product statistics (HTML scrape)
- data-gov-in       — data.gov.in open datasets (key-gated)

Output: Events tagged `india-gov:<sub-source>`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from ..types import Event
from ..utils import event_hash

USER_AGENT = "high-signal/0.1 india-gov-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 8
CONTENT_CAP = 20_000

# ---------------------------------------------------------------------------
# RSS feeds (keyless — feedparser pattern from gov.py)
# ---------------------------------------------------------------------------

# SEBI: https://www.sebi.gov.in/rss.html  →  subscribe URL is sebirss.xml
_SEBI_RSS = "https://www.sebi.gov.in/sebirss.xml"
# RBI: https://rbi.org.in/Scripts/rss.aspx lists feeds; press releases XML:
_RBI_RSS = "https://www.rbi.org.in/pressreleases_rss.xml"
# BSE corporate announcements — XML link (acts as an RSS/Atom feed)
_BSE_ANN_RSS = "https://www.bseindia.com/Master/XMLLinks/GetLatestAnnouncements.aspx"

# (id, name, rss_url)
RSS_FEEDS: list[tuple[str, str, str]] = [
    ("sebi", "SEBI", _SEBI_RSS),
    ("rbi", "RBI", _RBI_RSS),
    ("bse-announcements", "BSE Announcements", _BSE_ANN_RSS),
]


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            return ""
        return r.text
    except httpx.HTTPError:
        return ""


async def _fetch_rss(
    fid: str,
    name: str,
    url: str,
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
        title = (entry.get("title") or "").strip()
        body = (entry.get("summary") or entry.get("description") or "").strip()
        published = entry.get("published") or entry.get("updated") or ""
        try:
            pub = parsedate_to_datetime(published) if published else None
            if pub is None or pub.tzinfo is None:
                pub = (pub or datetime.now(timezone.utc)).replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if pub < since:
            continue
        source_url = link or url
        raw_hash = event_hash("india-gov", fid, source_url, title)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"india-gov:{fid}",
                source_url=source_url,
                published_at=pub,
                title=f"{name}: {title}" if title else name,
                content=(body[:CONTENT_CAP] or None),
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# NSE corporate announcements (JSON API — browser-like headers)
# ---------------------------------------------------------------------------

_NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
    "X-Requested-With": "XMLHttpRequest",
}
_NSE_HOME = "https://www.nseindia.com/"
_NSE_ANN = "https://www.nseindia.com/api/corporate-announcements?index=equities"


async def _fetch_nse_announcements(
    since: datetime, client: httpx.AsyncClient
) -> list[Event]:
    out: list[Event] = []
    try:
        # NSE requires a homepage hit to seed cookies before the API call.
        home = await client.get(_NSE_HOME, headers=_NSE_HEADERS)
        if home.status_code != 200:
            return []
        r = await client.get(_NSE_ANN, headers=_NSE_HEADERS)
        if r.status_code != 200:
            return []
        data = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("nse fetch failed: %s", exc)
        return []
    items = data if isinstance(data, list) else data.get("data") or []
    for item in items[:50]:
        if not isinstance(item, dict):
            continue
        sym = str(item.get("symbol") or item.get("Symbol") or "").strip()
        desc = str(
            item.get("desc") or item.get("description") or item.get("subject") or ""
        ).strip()
        company = str(
            item.get("companyName") or item.get("company") or sym
        ).strip()
        ann_dt = str(
            item.get("date")
            or item.get("announcementDate")
            or item.get("disseminationTime")
            or ""
        ).strip()
        pub = _parse_nse_date(ann_dt)
        if pub is None or pub < since:
            continue
        title = f"{company}: {desc}" if desc else company
        attachment = str(item.get("attachment") or item.get("pdf") or "").strip()
        if attachment:
            source_url = attachment
        elif sym:
            source_url = f"https://www.nseindia.com/companies/{sym}"
        else:
            source_url = _NSE_ANN
        raw_hash = event_hash("india-gov", "nse-announcements", sym, desc, ann_dt)
        out.append(
            Event(
                id=raw_hash[:16],
                source="india-gov:nse-announcements",
                source_url=source_url,
                published_at=pub,
                title=title[:500],
                content=(desc[:CONTENT_CAP] or None),
                raw_hash=raw_hash,
            )
        )
    return out


def _parse_nse_date(value: str) -> datetime | None:
    """NSE returns dates in varied formats: ISO, ``DD-MMM-YYYY HH:MM:SS``, etc."""
    if not value:
        return None
    # Try ISO first (utils-style)
    for cand in (value[:19].replace("Z", "+00:00"), value[:10]):
        try:
            dt = datetime.fromisoformat(cand)
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            continue
    # DD-MMM-YYYY HH:MM:SS  (e.g. 02-Jun-2026 14:30:00)
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%m-%Y %H:%M:%S", "%d-%b-%Y"):
        try:
            dt = datetime.strptime(value[:19].strip(), fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# AMFI mutual-fund NAVs via mfapi.in (JSON API, keyless)
# ---------------------------------------------------------------------------

_MFAPI_LIST = "https://api.mfapi.in/mf"
# Curated set of large/popular AMFI scheme codes to fetch NAVs for.
_MF_SCHEMES: dict[str, str] = {
    "119551": "SBI Bluechip Fund",
    "120716": "HDFC Mid-Cap Opportunities Fund",
    "118834": "Mirae Asset Large Cap Fund",
    "119206": "Axis Bluechip Fund",
    "120478": "Kotak Standard Multicap Fund",
    "101206": "ICICI Prudential Bluechip Fund",
    "119593": "Aditya Birla Sun Life Frontline Equity Fund",
    "119298": "Nippon India Large Cap Fund",
    "119379": "DSP Top 100 Equity Fund",
    "120469": "UTI Mastershare Unit Scheme",
}


async def _fetch_amfi(
    since: datetime, client: httpx.AsyncClient
) -> list[Event]:
    out: list[Event] = []

    async def _one(code: str, name: str) -> Event | None:
        url = f"{_MFAPI_LIST}/{code}"
        try:
            r = await client.get(url, headers={"User-Agent": USER_AGENT})
            if r.status_code != 200:
                return None
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("amfi %s failed: %s", code, exc)
            return None
        meta = payload.get("meta") or {}
        data = payload.get("data") or []
        if not data:
            return None
        latest = data[0]
        nav = str(latest.get("nav") or "").strip()
        nav_date = str(latest.get("date") or "").strip()
        pub = _parse_amfi_date(nav_date)
        if pub is None:
            pub = datetime.now(timezone.utc)
        if pub < since:
            return None
        fund_name = str(meta.get("scheme_name") or name)
        title = f"AMFI NAV: {fund_name} = ₹{nav} ({nav_date})"
        content = (
            f"Mutual Fund NAV update — {fund_name} (code {code}). "
            f"NAV ₹{nav} as on {nav_date}. "
            f"Category: {meta.get('scheme_category','n/a')}. "
            f"Type: {meta.get('scheme_type','n/a')}."
        )
        raw_hash = event_hash("india-gov", "amfi", code, nav, nav_date)
        return Event(
            id=raw_hash[:16],
            source="india-gov:amfi",
            source_url=f"https://api.mfapi.in/mf/{code}",
            published_at=pub,
            title=title[:500],
            content=content[:CONTENT_CAP],
            raw_hash=raw_hash,
        )

    results = await asyncio.gather(
        *(_one(code, name) for code, name in _MF_SCHEMES.items())
    )
    for ev in results:
        if ev is not None:
            out.append(ev)
    return out


def _parse_amfi_date(value: str) -> datetime | None:
    """mfapi.in NAV dates: ``DD-MM-YYYY``."""
    if not value:
        return None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d-%b-%Y"):
        try:
            dt = datetime.strptime(value.strip(), fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# MOSPI eSankhyiki (JSON API — keyless, returns first 10 records w/o token)
# ---------------------------------------------------------------------------

_MOSPI_BASE = "https://api.mospi.gov.in"
# Keyless endpoints (first 10 records without an access token).
_MOSPI_ENDPOINTS: list[tuple[str, str, dict[str, str]]] = [
    (
        "cpi",
        "CPI Index (General)",
        {"Series": "Current_series_2012", "Level": "Group"},
    ),
    (
        "iip",
        "IIP (Monthly)",
        {"BaseYear": "2011-12", "Frequency": "Monthly"},
    ),
]


async def _fetch_mospi(
    since: datetime, client: httpx.AsyncClient
) -> list[Event]:
    out: list[Event] = []

    async def _one(fid: str, label: str, params: dict[str, str]) -> list[Event]:
        url = f"{_MOSPI_BASE}/api/getCPIIndex" if fid == "cpi" else f"{_MOSPI_BASE}/api/getIIPIndex"
        try:
            r = await client.get(
                url, params=params, headers={"User-Agent": USER_AGENT}
            )
            if r.status_code != 200:
                return []
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("mospi %s failed: %s", fid, exc)
            return []
        rows = payload if isinstance(payload, list) else payload.get("data") or []
        results: list[Event] = []
        for row in rows[:10]:
            if not isinstance(row, dict):
                continue
            year = str(row.get("Year") or row.get("year") or "").strip()
            month = str(row.get("Month") or row.get("month") or "").strip()
            value = str(
                row.get("Index") or row.get("index") or row.get("Value") or ""
            ).strip()
            if not value or not year:
                continue
            pub = _parse_mospi_date(year, month)
            if pub is None or pub < since:
                continue
            title = f"MOSPI {label}: {value} ({month} {year})"
            content = (
                f"{label} = {value} for {month} {year}. "
                f"Source: MoSPI eSankhyiki (api.mospi.gov.in)."
            )
            raw_hash = event_hash("india-gov", "mospi", fid, year, month, value)
            results.append(
                Event(
                    id=raw_hash[:16],
                    source="india-gov:mospi",
                    source_url=f"{_MOSPI_BASE}/api/{'getCPIIndex' if fid=='cpi' else 'getIIPIndex'}",
                    published_at=pub,
                    title=title[:500],
                    content=content[:CONTENT_CAP],
                    raw_hash=raw_hash,
                )
            )
        return results

    batches = await asyncio.gather(
        *(_one(fid, label, params) for fid, label, params in _MOSPI_ENDPOINTS)
    )
    for batch in batches:
        out.extend(batch)
    return out


def _parse_mospi_date(year: str, month: str) -> datetime | None:
    """MoSPI months are names (``January``) or numbers; year is ``YYYY``."""
    if not year:
        return None
    try:
        y = int(year)
    except ValueError:
        return None
    months = {
        "january": 1, "february": 2, "march": 3, "april": 4,
        "may": 5, "june": 6, "july": 7, "august": 8,
        "september": 9, "october": 10, "november": 11, "december": 12,
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7,
        "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }
    m = months.get(month.strip().lower())
    if m is None:
        try:
            m = int(month)
        except ValueError:
            m = 1
    if m < 1 or m > 12:
        m = 1
    try:
        return datetime(y, m, 1, tzinfo=timezone.utc)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# NPCI UPI product statistics (HTML scrape — table extraction)
# ---------------------------------------------------------------------------

_UPI_URL = "https://www.npci.org.in/what-we-do/upi/product-statistics"
_UPI_ROW_RE = re.compile(
    r"<tr[^>]*>\s*<td[^>]*>\s*([A-Za-z]{3}-\d{4})\s*</td>"
    r"\s*<td[^>]*>\s*([\d,]+)\s*</td>"  # banks
    r"\s*<td[^>]*>\s*([\d,.]+)\s*</td>"  # volume (Mn)
    r"\s*<td[^>]*>\s*([\d,.]+)\s*</td>",  # value (Cr)
    re.IGNORECASE | re.DOTALL,
)


async def _fetch_upi_npci(
    since: datetime, client: httpx.AsyncClient
) -> list[Event]:
    try:
        r = await client.get(_UPI_URL, headers={"User-Agent": USER_AGENT})
        if r.status_code != 200:
            return []
        html = r.text
    except httpx.HTTPError as exc:
        LOGGER.debug("upi-npci fetch failed: %s", exc)
        return []
    out: list[Event] = []
    for m in _UPI_ROW_RE.finditer(html):
        month_str, banks, volume, value = m.groups()
        pub = _parse_upi_month(month_str)
        if pub is None or pub < since:
            continue
        title = f"UPI Stats: {month_str} — {volume} Mn txns, ₹{value} Cr"
        content = (
            f"NPCI UPI Product Statistics for {month_str}. "
            f"Banks live on UPI: {banks}. "
            f"Volume (Mn): {volume}. "
            f"Value (₹ Cr): {value}. "
            f"Source: {_UPI_URL}"
        )
        raw_hash = event_hash("india-gov", "upi-npci", month_str)
        out.append(
            Event(
                id=raw_hash[:16],
                source="india-gov:upi-npci",
                source_url=_UPI_URL,
                published_at=pub,
                title=title[:500],
                content=content[:CONTENT_CAP],
                raw_hash=raw_hash,
            )
        )
    # Keep only the most recent few months within window
    return out[:6]


def _parse_upi_month(value: str) -> datetime | None:
    """Parse ``May-2026`` style month labels from the NPCI table."""
    if not value:
        return None
    months = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }
    parts = value.strip().split("-")
    if len(parts) != 2:
        return None
    m = months.get(parts[0].lower())
    try:
        y = int(parts[1])
    except ValueError:
        return None
    if m is None:
        return None
    try:
        return datetime(y, m, 1, tzinfo=timezone.utc)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# data.gov.in (key-gated — skip gracefully without DATA_GOV_IN_API_KEY)
# ---------------------------------------------------------------------------

_DATA_GOV_IN_URL = "https://data.gov.in/api/datastore/resource.json"
# Curated resource ids (high-value economic / agricultural datasets).
_DATA_GOV_RESOURCES: list[tuple[str, str]] = [
    ("e8c7ce0a-2d5a-4d1f-9b0a-9f9b9b9b9b9b", "data.gov.in dataset"),
]


def _fetch_data_gov_in(since: datetime, api_key: str | None) -> list[Event]:
    key = api_key or os.environ.get("DATA_GOV_IN_API_KEY")
    if not key:
        LOGGER.debug("data-gov-in skipped — DATA_GOV_IN_API_KEY not set")
        return []
    out: list[Event] = []
    for resource_id, label in _DATA_GOV_RESOURCES:
        try:
            r = httpx.get(
                _DATA_GOV_IN_URL,
                params={"resource_id": resource_id, "api-key": key},
                headers={"User-Agent": USER_AGENT},
                timeout=25.0,
            )
            if r.status_code != 200:
                continue
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("data-gov-in %s failed: %s", resource_id, exc)
            continue
        records = payload.get("records") or []
        for rec in records[:20]:
            if not isinstance(rec, dict):
                continue
            title = str(rec.get("title") or rec.get("name") or label).strip()
            body = str(rec)[:CONTENT_CAP]
            raw_hash = event_hash("india-gov", "data-gov-in", resource_id, title)
            out.append(
                Event(
                    id=raw_hash[:16],
                    source="india-gov:data-gov-in",
                    source_url=f"{_DATA_GOV_IN_URL}?resource_id={resource_id}",
                    published_at=datetime.now(timezone.utc),
                    title=title[:500],
                    content=body or None,
                    raw_hash=raw_hash,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def fetch_all_async(days: int = 3) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": USER_AGENT}
    timeout = httpx.Timeout(25.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        results = await asyncio.gather(
            *(
                _fetch_rss(fid, name, url, since, client)
                for fid, name, url in RSS_FEEDS
            ),
            _fetch_nse_announcements(since, client),
            _fetch_amfi(since, client),
            _fetch_mospi(since, client),
            _fetch_upi_npci(since, client),
        )
    events: list[Event] = []
    for batch in results:
        if isinstance(batch, list):
            events.extend(batch)
    # Key-gated source (sync httpx, skipped without key)
    events.extend(_fetch_data_gov_in(since, None))
    return events


def fetch_all(days: int = 3) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days))
