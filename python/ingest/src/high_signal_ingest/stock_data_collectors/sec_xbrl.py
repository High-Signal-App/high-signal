"""SEC XBRL companyfacts adapter.

Fetches company fundamentals from SEC companyfacts for tracked public tickers.
This does not compute market cap or fetch prices; market-cap derivation must
join these facts to the existing equities snapshot source of truth.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from dataclasses import replace
from typing import Any

import httpx

from ..types import Event
from ..stock_data.models import Entity, Fact, SourceRights, canonical_json, instant
from ..stock_data.store import StockStore
from ..stock_data_prices import stock_store_path
from ..stock_data_research import research_events


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


def normalize_companyfacts(
    entity_id: str, cik: str, payload: dict[str, Any], store: StockStore, *, ingested_at: str
) -> list[Fact]:
    """Retain units, reporting periods and amendments instead of flattening the latest value."""
    source_url = FACTS_URL.format(cik=cik)
    if str(payload.get("cik", "")).zfill(10) != str(cik).zfill(10):
        raise ValueError("SEC companyfacts issuer does not match the requested CIK")
    now = instant(ingested_at)
    evidence = store.retain_evidence(
        source_id="sec-xbrl",
        url=source_url,
        body=canonical_json(payload).encode(),
        available_at=ingested_at,
        ingested_at=ingested_at,
    )
    store.put_entity(
        Entity(entity_id, str(payload.get("entityName") or entity_id), "US", {"cik": cik})
    )
    output: list[Fact] = []
    if store.rights("sec-xbrl") is None:
        store.put_rights(
            SourceRights(
                "sec-xbrl",
                "https://www.sec.gov/about/developer-resources",
                note="Original structured filings. Public display and export rights not yet qualified.",
            )
        )
    namespaces = payload.get("facts", {})
    for namespace in ("us-gaap", "dei"):
        for concept, detail in namespaces.get(namespace, {}).items():
            label = FACTS.get(concept)
            if not label:
                continue
            for unit, rows in detail.get("units", {}).items():
                if (label == "shares_outstanding") != (unit == "shares"):
                    continue
                for row in rows:
                    if (
                        row.get("val") is None
                        or not row.get("end")
                        or not row.get("filed")
                        or not row.get("accn")
                    ):
                        continue
                    try:
                        # The SEC gives a filing day, not its exact acceptance time.
                        # Availability starts at the end of that day to avoid same-day lookahead.
                        available_at = f"{row['filed']}T23:59:59Z"
                        if instant(available_at) > now:
                            continue
                        fact = Fact(
                            entity_id=entity_id,
                            metric=label,
                            value=str(row["val"]),
                            unit=unit,
                            effective_at=f"{row['end']}T00:00:00Z",
                            available_at=available_at,
                            ingested_at=ingested_at,
                            evidence_id=evidence.id,
                            locator=f"/facts/{namespace}/{concept}/units/{unit}/accession={row['accn']}/period={row.get('start', '')}:{row['end']}",
                            dimensions={
                                "concept": concept,
                                "namespace": namespace,
                                "period_start": str(row.get("start") or ""),
                                "period_end": row["end"],
                                "accession": row["accn"],
                                "form": str(row.get("form") or ""),
                                "accounting_basis": "unspecified",
                            },
                            extractor_version="sec-companyfacts.v1",
                        )
                        output.append(fact)
                    except (ValueError, TypeError):
                        LOGGER.warning("invalid SEC fact: entity=%s concept=%s", entity_id, concept)
    # Facts are historically public on the filing date, while the fetched API
    # response is first observed now. Derived extraction receipts retain each
    # fact's accession/locator and link back to that exact retained API response.
    retained = []
    for fact in output:
        row_evidence = store.retain_evidence(
            source_id="sec-xbrl",
            url=source_url,
            body=canonical_json(
                {
                    "locator": fact.locator,
                    "fact": {
                        k: v
                        for k, v in fact.to_dict().items()
                        if k not in {"id", "evidence_id", "ingested_at"}
                    },
                }
            ).encode(),
            available_at=fact.available_at,
            ingested_at=ingested_at,
        )
        retained.append(replace(fact, evidence_id=row_evidence.id))
    store.put_facts(retained)
    store.save_snapshot(
        {
            "response_evidence_id": evidence.id,
            "input_fact_ids": sorted(f.id for f in retained),
            "extractor_version": "sec-companyfacts.v1",
        }
    )
    return retained


def event_from_companyfacts(
    ticker: str,
    entity_id: str,
    cik: str,
    payload: dict[str, Any],
    since: datetime,
    *,
    store: StockStore | None = None,
) -> Event | None:
    owned = store is None
    store = store or StockStore(stock_store_path())
    try:
        now = datetime.now(timezone.utc).isoformat()
        previous = store.dataset(
            as_of=now, entity_id=entity_id, audience="display", freshness_days=550
        )
        with store.transaction():
            normalize_companyfacts(entity_id, cik, payload, store, ingested_at=now)
        dataset = store.dataset(
            as_of=now, entity_id=entity_id, audience="display", freshness_days=550
        )
        events = research_events(previous, dataset)
        recent = [event for event in events if event.published_at >= since]
        return recent[-1] if recent else None
    finally:
        if owned:
            store.close()


def fetch_all(days: int = 120, limit: int = 25) -> list[Event]:
    from ..seed import load_entities

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
            raise RuntimeError("SEC ticker map unavailable") from exc
        failures = []
        for ticker, entity_id in tickers:
            cik = ticker_map.get(ticker)
            if not cik:
                continue
            try:
                response = client.get(FACTS_URL.format(cik=cik))
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError):
                failures.append(ticker)
                continue
            if isinstance(payload, dict):
                event = event_from_companyfacts(ticker, entity_id, cik, payload, since)
                if event:
                    out.append(event)
        if failures:
            raise RuntimeError(f"SEC companyfacts refresh failed for {len(failures)} issuers")
    return out
