"""SEC XBRL companyfacts adapter.

Fetches company fundamentals from SEC companyfacts for tracked public tickers.
This does not compute market cap or fetch prices; market-cap derivation must
join these facts to the existing equities snapshot source of truth.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..seed import load_entities
from ..types import Event, SourceDocument


USER_AGENT = "high-signal/0.1 sec-xbrl-ingest"
DEFAULT_SEC_USER_AGENT = "high-signal research@example.com"
LOGGER = logging.getLogger(__name__)
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
FACTS = {
    "Revenues": "revenue",
    "RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
    "NetIncomeLoss": "net_income",
    "Assets": "assets",
    "Liabilities": "liabilities",
    "CommonStocksIncludingAdditionalPaidInCapital": "common_stock_capital",
    "EntityCommonStockSharesOutstanding": "shares_outstanding",
}


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT", DEFAULT_SEC_USER_AGENT)


def ticker_cik_map(payload: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for value in payload.values():
        if not isinstance(value, dict):
            continue
        ticker = str(value.get("ticker") or "").upper()
        cik = str(value.get("cik_str") or "").strip()
        if ticker and cik:
            out[ticker] = cik.zfill(10)
    return out


def _latest_fact(us_gaap: dict[str, Any], fact_name: str, since: datetime) -> dict[str, Any] | None:
    fact = us_gaap.get(fact_name)
    if not isinstance(fact, dict):
        return None
    units = fact.get("units") if isinstance(fact.get("units"), dict) else {}
    rows: list[dict[str, Any]] = []
    for unit_rows in units.values():
        if isinstance(unit_rows, list):
            rows.extend(row for row in unit_rows if isinstance(row, dict))
    candidates: list[tuple[datetime, dict[str, Any]]] = []
    for row in rows:
        filed = str(row.get("filed") or "")
        try:
            filed_at = datetime.fromisoformat(filed[:10]).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if filed_at >= since and row.get("val") is not None:
            candidates.append((filed_at, row))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def event_from_companyfacts(
    ticker: str, entity_id: str, cik: str, payload: dict[str, Any], since: datetime
) -> Event | None:
    facts = payload.get("facts") if isinstance(payload.get("facts"), dict) else {}
    us_gaap = facts.get("us-gaap") if isinstance(facts.get("us-gaap"), dict) else {}
    latest: dict[str, dict[str, Any]] = {}
    latest_filed: datetime | None = None
    for fact_name, label in FACTS.items():
        row = _latest_fact(us_gaap, fact_name, since)
        if not row:
            continue
        latest[label] = row
        filed_at = datetime.fromisoformat(str(row["filed"])[:10]).replace(tzinfo=timezone.utc)
        latest_filed = filed_at if latest_filed is None else max(latest_filed, filed_at)
    if not latest or latest_filed is None:
        return None
    raw_hash = _hash("sec-xbrl", ticker, latest_filed.date().isoformat(), str(sorted(latest)))
    content = "\n".join(
        f"{label}: {row.get('val')} ({row.get('form')} filed {row.get('filed')})"
        for label, row in sorted(latest.items())
    )
    return Event(
        id=raw_hash[:16],
        source=f"sec-xbrl:{ticker.lower()}",
        source_url=f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
        published_at=latest_filed,
        title=f"SEC XBRL fundamentals: {ticker}",
        content=content[:20_000] or None,
        primary_entity_id=entity_id,
        raw_hash=raw_hash,
        source_document=SourceDocument(
            canonical_url=f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
            published_at=latest_filed,
            raw_hash=raw_hash,
            raw_json={"latest": latest},
            parsed_fields={
                "ticker": ticker,
                "cik": cik,
                "facts": sorted(latest.keys()),
            },
        ),
    )


def fetch_all(days: int = 120, limit: int = 25) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": _user_agent(), "Accept": "application/json"}
    tickers = [
        (entity.ticker.upper(), entity.id)
        for entity in load_entities()
        if entity.ticker and entity.type == "public" and "." not in entity.ticker
    ][:limit]
    out: list[Event] = []
    with httpx.Client(headers=headers, timeout=20.0, follow_redirects=True) as client:
        try:
            ticker_response = client.get(TICKERS_URL)
            ticker_response.raise_for_status()
            ticker_map = ticker_cik_map(ticker_response.json())
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("sec ticker map fetch failed error=%s", exc)
            return []
        for ticker, entity_id in tickers:
            cik = ticker_map.get(ticker)
            if not cik:
                continue
            try:
                response = client.get(FACTS_URL.format(cik=cik))
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("sec xbrl fetch failed ticker=%s error=%s", ticker, exc)
                continue
            if isinstance(payload, dict):
                event = event_from_companyfacts(ticker, entity_id, cik, payload, since)
                if event:
                    out.append(event)
    return out
