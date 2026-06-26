"""EIA energy adapter (free key; skipped without one).

Electric power is the gating constraint for the data-center / AI-infra thesis:
where industrial electricity is cheap and abundant is where hyperscale capacity
gets sited. The US Energy Information Administration exposes electricity data
over a free API (register a key at eia.gov/opendata). We emit monthly
industrial retail electricity price for the data-center-heavy states as events,
following the same numeric-series-as-event pattern as `macro_rates`.

Requires ``EIA_API_KEY``. Skipped without a key so daily ingest stays green.
Numeric/series data — entity-less, feeds the finance/technology domains as
macro context. No standalone entity signals expected.

Output: Events tagged `source: eia`.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 eia-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://api.eia.gov/v2/electricity/retail-sales/data/"
SERIES_URL = "https://www.eia.gov/electricity/data.php"
# Data-center / fab corridors + large grids.
STATES = ("VA", "TX", "OH", "AZ", "GA", "OR", "NV", "NC", "IA", "WA", "UT", "WI", "NY", "CA")


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _period_to_dt(period: str) -> datetime | None:
    # EIA monthly periods are "YYYY-MM".
    try:
        year, month = period.split("-")[:2]
        return datetime(int(year), int(month), 1, tzinfo=timezone.utc)
    except (ValueError, IndexError):
        return None


def events_from_response(payload: dict[str, Any], since: datetime) -> list[Event]:
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}
    rows = response.get("data") if isinstance(response.get("data"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        period = str(row.get("period") or "").strip()
        state = str(row.get("stateid") or "").strip()
        price = row.get("price")
        published = _period_to_dt(period)
        if not period or not state or price is None or published is None or published < since:
            continue
        units = str(row.get("price-units") or "cents per kilowatthour").strip()
        raw_hash = _hash("eia", "retail-price-ind", state, period)
        out.append(
            Event(
                id=raw_hash[:16],
                source="eia",
                # Distinct per (state, period) so write-path dedup doesn't
                # collapse all rows sharing the data.php landing page.
                source_url=f"{SERIES_URL}?state={state}&period={period}",
                published_at=published,
                title=f"EIA industrial electricity price {state}: {price} ({period})",
                content=f"{state} industrial retail electricity price for {period}: {price} {units}.",
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 120, api_key: str | None = None) -> list[Event]:
    key = api_key or os.environ.get("EIA_API_KEY")
    if not key:
        LOGGER.debug("eia skipped: EIA_API_KEY is not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    params: list[tuple[str, Any]] = [
        ("api_key", key),
        ("frequency", "monthly"),
        ("data[0]", "price"),
        ("facets[sectorid][]", "IND"),
        ("sort[0][column]", "period"),
        ("sort[0][direction]", "desc"),
        ("length", "120"),
    ]
    params.extend(("facets[stateid][]", s) for s in STATES)
    try:
        resp = httpx.get(
            API_URL,
            params=params,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=25.0,
            follow_redirects=True,
        )
        resp.raise_for_status()
        payload = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("eia fetch failed: %s", exc)
        return []
    return events_from_response(payload, since) if isinstance(payload, dict) else []
