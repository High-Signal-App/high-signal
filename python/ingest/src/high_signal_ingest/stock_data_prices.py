"""Canonical equity refresh persistence. This module never fetches market data."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from .sources.equities.snapshot import Close
from .sources.equities.universe import TickerSpec
from .stock_data.models import Entity, Fact, Security, SourceRights, content_id, utc
from .stock_data.store import StockStore


def stock_store_path(data_dir: Path | None = None) -> Path:
    if data_dir is None:
        data_dir = next(
            p / "data" for p in Path(__file__).resolve().parents if (p / "data").is_dir()
        )
    return data_dir / "stock-data" / "stock-data.sqlite"


def issuer_id(store: StockStore, spec: TickerSpec) -> str:
    existing = store.connection.execute(
        "SELECT payload FROM identities WHERE kind='security' AND id=? ORDER BY sequence DESC LIMIT 1",
        (f"security:{spec.ticker}",),
    ).fetchone()
    if existing:
        return json.loads(existing["payload"])["entity_id"]
    return f"issuer:{spec.wikidata_id or ('cik:' + spec.cik if spec.cik else spec.ticker)}"


def persist_prices(
    store: StockStore, spec: TickerSpec, closes: list[Close], *, ingested_at: str
) -> list[str]:
    """Retain the single ingress's observations, including provider adjustment basis.

    A downloaded backfill was not observed historically. Its public availability
    is conservatively the retrieval time. Yahoo's Close is split-adjusted, so only
    the latest Close may enter a current nominal-price valuation.
    """
    entity_id = issuer_id(store, spec)
    security_id = f"security:{spec.ticker}"
    store.put_entity(Entity(entity_id, spec.name or spec.ticker, spec.country or "unknown"))
    store.put_security(Security(security_id, entity_id, spec.ticker, spec.currency or "unknown"))
    store.put_rights(
        SourceRights(
            "yahoo-finance",
            "https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html",
            note="Existing provider. Display, export and internal-use permissions require review; not inferred from fetchability.",
        )
    )
    if not closes:
        return []
    # Reuse unchanged evidence so a daily retry does not duplicate six years of facts.
    existing = {
        (f.effective_at[:10], f.metric): f
        for f in store.facts(as_of=ingested_at, entity_id=entity_id)
        if f.dimensions.get("ticker") == spec.ticker
    }
    facts: list[Fact] = []
    for close in closes:
        day = datetime.strptime(str(close.date), "%Y%m%d").date().isoformat()
        values = {
            "adjusted_close": close.close,
            "provider_close": close.provider_close,
            "volume": close.volume,
        }
        if close.split_ratio:
            values["split_ratio"] = close.split_ratio
        if close.dividend:
            values["dividend"] = close.dividend
        for metric, value in values.items():
            if value is None:
                continue
            value_string = str(value)
            prior = existing.get((day, metric))
            if prior is not None and prior.value == value_string:
                continue
            body = json.dumps(
                {"ticker": spec.ticker, "date": day, metric: value_string}, sort_keys=True
            ).encode()
            evidence = store.retain_evidence(
                source_id="yahoo-finance",
                url=f"https://finance.yahoo.com/quote/{spec.ticker}/history/",
                body=body,
                available_at=ingested_at,
                ingested_at=ingested_at,
            )
            facts.append(
                Fact(
                    entity_id=entity_id,
                    metric=metric,
                    value=value_string,
                    unit="ratio"
                    if metric == "split_ratio"
                    else "units"
                    if metric == "volume"
                    else (spec.currency or "unknown"),
                    effective_at=f"{day}T00:00:00Z",
                    available_at=ingested_at,
                    ingested_at=ingested_at,
                    evidence_id=evidence.id,
                    locator=f"{day}/{metric}",
                    dimensions={
                        "ticker": spec.ticker,
                        "security_id": security_id,
                        "price_basis": "total_return_adjusted"
                        if metric == "adjusted_close"
                        else "provider_split_adjusted",
                    },
                    extractor_version="canonical-equities.v1",
                )
            )
    return store.put_facts(facts)


def price_inputs(
    store: StockStore, ticker: str, closes: list[Close], spy_closes: list[Close], *, as_of: str
) -> str:
    inputs = []
    cutoff = utc(as_of)
    for symbol, series, metrics in (
        (ticker, closes, {"adjusted_close", "volume"}),
        ("SPY.US", spy_closes, {"adjusted_close"}),
    ):
        expected = {
            (str(close.date), metric)
            for close in series
            for metric in metrics
            if metric != "volume" or close.volume is not None
        }
        rows = store.connection.execute(
            "SELECT id,payload FROM facts WHERE ticker=? ORDER BY effective_at,available_at,ingested_at,id",
            (symbol,),
        )
        latest = {}
        for row in rows:
            fact = Fact(**json.loads(row["payload"]))
            key = (fact.effective_at[:10].replace("-", ""), fact.metric)
            if key in expected and fact.available_at <= cutoff:
                latest[key] = fact.id
        if set(latest) != expected:
            raise ValueError("Indicator inputs were not fully retained")
        inputs.extend(latest.values())
    return store.save_snapshot(
        {"model_version": "equity-indicators.v1", "input_fact_ids": sorted(set(inputs))}
    )


def versioned_prices(
    rows: list[dict],
    *,
    generated_at: str,
    history_available: bool,
    rights: SourceRights | None = None,
) -> dict:
    """One versioned input for all price consumers; no wall clock in numerical IDs."""
    normalized = []
    for row in sorted(rows, key=lambda r: r["ticker"]):
        row = dict(row)
        row["entityId"] = row.get("entityId") or (
            f"issuer:{row.get('wikidata_id') or ('cik:' + row['cik'] if row.get('cik') else row['ticker'])}"
        )
        row["identityStatus"] = (
            "verified_identifier"
            if row.get("wikidata_id") or row.get("cik")
            else "provisional_listing_identity"
        )
        row["securityId"] = f"security:{row['ticker']}"
        row["sourceRefs"] = [
            {
                "sourceId": "yahoo-finance",
                "url": f"https://finance.yahoo.com/quote/{row['ticker']}/history/",
            }
        ]
        row["priceBasis"] = "total_return_adjusted"
        if row.get("last_close") is not None and not row.get("inputSnapshotIds"):
            raise ValueError("Price indicators require retained versioned inputs")
        row["completeness"] = "partial" if row.get("last_close") is not None else "unavailable"
        row["inputSnapshotId"] = content_id("price-row", row)
        normalized.append(row)
    identity = {"contractVersion": "stock-data.prices.v1", "rows": normalized}
    return {
        **identity,
        "snapshotId": content_id("prices", identity),
        "generatedAt": generated_at,
        "completeness": "partial"
        if any(row.get("last_close") is not None for row in normalized)
        else "unavailable",
        "availableAt": generated_at,
        "ingestedAt": generated_at,
        "historyAvailable": history_available,
        "coverage": {
            "scope": "configured universe; not all Indian listings",
            "financials": "unavailable",
            "ownership": "unavailable",
        },
        "rights": {
            "publicDisplay": rights.public_display if rights else "unknown",
            "export": rights.export if rights else "unknown",
            "policyUrl": rights.policy_url
            if rights
            else "https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html",
        },
    }
