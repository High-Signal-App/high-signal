"""Free, attributed ECB reference FX observations. No equity-price collection."""

from __future__ import annotations

from datetime import datetime, timezone
from xml.etree import ElementTree

import httpx

from ..stock_data.models import Entity, Fact, SourceRights, decimal_value
from ..stock_data.store import StockStore
from ..stock_data_prices import stock_store_path

URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
POLICY = "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html"


def retain_rates(store: StockStore, body: bytes, *, ingested_at: str) -> list[Fact]:
    root = ElementTree.fromstring(body)
    dates = [node for node in root.iter() if node.get("time")]
    if len(dates) != 1:
        raise ValueError("ECB FX response lacks one reference date")
    node = dates[0]
    day = node.attrib["time"]
    datetime.strptime(day, "%Y-%m-%d")
    evidence = store.retain_evidence(
        source_id="ecb-fx",
        url=URL,
        body=body,
        available_at=ingested_at,
        ingested_at=ingested_at,
        media_type="application/xml",
    )
    store.put_entity(
        Entity("currency:EUR", "Euro reference rates", "global", {"asset_type": "currency"})
    )
    store.put_rights(
        SourceRights(
            "ecb-fx",
            POLICY,
            "permitted",
            "permitted",
            "permitted",
            reviewed_at="2026-10-29T00:00:00Z",
            note="Source: ECB statistics. Original reference rates and metadata are retained unchanged; no third-party statistics.",
        )
    )
    facts = []
    for rate in node:
        currency, value = rate.get("currency"), rate.get("rate")
        if not currency or value is None or decimal_value(value) <= 0:
            raise ValueError("Invalid ECB reference rate")
        facts.append(
            Fact(
                entity_id="currency:EUR",
                metric="fx_rate",
                value=value,
                unit=f"EUR/{currency}",
                effective_at=f"{day}T00:00:00Z",
                available_at=ingested_at,
                ingested_at=ingested_at,
                evidence_id=evidence.id,
                locator=f"Cube time={day}/Cube currency={currency}",
                dimensions={"base_currency": "EUR", "quote_currency": currency},
                extractor_version="ecb-fx.v1",
            )
        )
    if not facts:
        raise ValueError("ECB reference rates unavailable")
    store.put_facts(facts)
    return facts


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    response = httpx.get(URL, timeout=30)
    response.raise_for_status()
    with StockStore(stock_store_path()) as store, store.transaction():
        facts = retain_rates(store, response.content, ingested_at=now)
    print(f"Retained {len(facts)} attributed ECB reference rates")


if __name__ == "__main__":
    main()
