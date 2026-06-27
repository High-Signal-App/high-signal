"""BLS economic-data adapter (free, key-less v1 API).

Real-time US macro releases for the **finance** domain — CPI, unemployment,
payrolls, earnings, PPI. Complements FRED (which `macro_rates` uses for rate
series) by surfacing the headline labour/inflation prints as dated events.
Uses the BLS public API v1 (key-less; a free `BLS_API_KEY` lifts the daily
limit but isn't required for a handful of series).

Output: Events tagged `source: bls` — latest observation per series.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

from ..types import Event
from ..utils import event_hash

USER_AGENT = "high-signal/0.1 bls-ingest"
LOGGER = logging.getLogger(__name__)
V1_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
V2_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
SERIES_PAGE = "https://www.bls.gov/news.release/"

# series id → (human label, unit)
SERIES: dict[str, tuple[str, str]] = {
    "CUUR0000SA0": ("CPI (all items, index)", "index 1982-84=100"),
    "CUUR0000SA0L1E": ("Core CPI (ex food & energy)", "index"),
    "LNS14000000": ("Unemployment rate", "%"),
    "CES0000000001": ("Nonfarm payrolls (total)", "thousands"),
    "CES0500000003": ("Avg hourly earnings", "$"),
    "WPUFD4": ("PPI (final demand, index)", "index"),
}
_MONTH = {f"M{m:02d}": m for m in range(1, 13)}


def events_from_response(payload: dict, since: datetime) -> list[Event]:
    out: list[Event] = []
    for s in payload.get("Results", {}).get("series", []) if isinstance(payload, dict) else []:
        sid = str(s.get("seriesID") or "")
        label, unit = SERIES.get(sid, (sid, ""))
        data = s.get("data") or []
        if not data:
            continue
        latest = data[0]  # BLS returns newest-first
        value = str(latest.get("value") or "").strip()
        year = str(latest.get("year") or "").strip()
        period = str(latest.get("period") or "").strip()
        month = _MONTH.get(period)
        if not value or not year or month is None:
            continue
        published = datetime(int(year), month, 1, tzinfo=timezone.utc)
        if published < since:
            continue
        raw_hash = event_hash("bls", sid, year, period)
        out.append(
            Event(
                id=raw_hash[:16],
                source="bls",
                # Distinct per series so write-path dedup doesn't collapse all
                # prints sharing the news.release landing page.
                source_url=f"{SERIES_PAGE}?series={sid}",
                published_at=published,
                title=f"BLS {label}: {value} ({latest.get('periodName')} {year})",
                content=f"{label} = {value} {unit} for {latest.get('periodName')} {year}.",
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 120, api_key: str | None = None) -> list[Event]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=max(days, 120))  # BLS prints lag ~1-2 months
    key = api_key or os.environ.get("BLS_API_KEY")
    body: dict[str, object] = {
        "seriesid": list(SERIES),
        "startyear": str(now.year - 1),
        "endyear": str(now.year),
    }
    url = V1_URL
    if key:
        body["registrationkey"] = key
        url = V2_URL
    try:
        r = httpx.post(url, json=body, headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"}, timeout=25.0)
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("bls fetch failed: %s", exc)
        return []
    return events_from_response(payload, since)
