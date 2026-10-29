"""Materialize rights-filtered contracts and editorial inputs from the shared ledger."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .stock_data.models import Fact, content_id
from .stock_data.store import StockStore
from .stock_data.valuation import (
    ListedHolding,
    OwnershipEdge,
    ValuationRequest,
    evaluate,
    detect_changes,
)
from .stock_data_prices import stock_store_path
from .stock_data_research import research_events
from .types import Event


def valuation_snapshots(dataset: dict) -> list[dict]:
    facts = [Fact(**{k: v for k, v in item.items() if k != "id"}) for item in dataset["facts"]]
    # Financial statement rows are not interchangeable with a reconciled valuation
    # model. This automatic path computes disclosed listed holdings only.
    edges = tuple(
        OwnershipEdge(f.entity_id, f.dimensions["asset_entity_id"], f)
        for f in facts
        if f.metric == "ownership_fraction" and "asset_entity_id" in f.dimensions
    )
    prices = {f.dimensions.get("security_id"): f for f in facts if f.metric == "raw_close"}
    parents = sorted({f.entity_id for f in facts if f.metric == "shares_owned"})
    return [_parent_valuation(parent, facts, prices, edges, dataset) for parent in parents]


def _parent_valuation(
    parent: str, facts: list[Fact], prices: dict, edges: tuple, dataset: dict
) -> dict:
    cap = next((f for f in facts if f.entity_id == parent and f.metric == "market_cap"), None)
    holdings = []
    missing = []
    for shares in (f for f in facts if f.metric == "shares_owned" and f.entity_id == parent):
        security_id = shares.dimensions.get("security_id")
        asset = shares.dimensions.get("asset_entity_id")
        if not security_id or not asset or security_id not in prices:
            missing.append(shares.id)
            continue
        holdings.append(ListedHolding(parent, asset, security_id, shares, prices[security_id]))
    result = evaluate(
        ValuationRequest(
            parent_entity_id=parent,
            currency=cap.unit if cap else "INR",
            as_of=dataset["as_of"],
            input_snapshot_ids=(dataset["snapshot_id"],),
            market_cap=cap,
            holdings=tuple(holdings),
            ownership=edges,
        )
    ).to_dict()
    # Excluding unsupported holdings is an explicitly partial calculation.
    result["missing_holding_fact_ids"] = missing
    return result


def materialize(
    store: StockStore, *, as_of: str, previous: dict | None = None, audience: str = "display"
) -> dict:
    dataset = store.dataset(
        as_of=as_of,
        audience=audience,
        required_metrics=("raw_close", "shares_owned", "market_cap"),
        freshness_days=550,
    )
    prior = {**previous, "facts": []} if previous else None
    if previous:
        for fact in previous.get("facts", []):
            document = store.evidence(fact["evidence_id"])
            rights = store.rights(document.source_id) if document else None
            if rights and rights.allows(audience):
                prior["facts"].append(fact)
    changes = detect_changes(prior, dataset)
    documents = {item["id"]: item for item in dataset["evidence"]}
    usage = {item["id"]: item for item in dataset["usage_rights"]}
    for change in changes:
        before = change.get("before")
        if before:
            document = store.evidence(before["evidence_id"])
            rights = store.rights(document.source_id)
            documents[document.id] = asdict(document)
            usage[rights.id] = asdict(rights)
            dataset["rights_versions"][rights.id] = rights.version_id
    included_entities = {fact["entity_id"] for fact in dataset["facts"]}
    publication = {
        **dataset,
        "entities": [entity for entity in store.identities() if entity["id"] in included_entities],
        "securities": [
            security
            for security in store.identities("security")
            if security["entity_id"] in included_entities
        ],
        "valuations": valuation_snapshots(dataset),
        "evidence": [documents[key] for key in sorted(documents)],
        "usage_rights": [usage[key] for key in sorted(usage)],
        "changes": changes,
        "coverage_scope": "configured companies only; India pilot not qualified",
    }
    return {"publication_id": content_id("publication", publication), **publication}


def fetch_research_inputs(days: int = 3) -> list[Event]:
    """Existing editorial orchestrator calls this adapter; there is no external fetch."""
    path = stock_store_path()
    if not path.exists():
        raise RuntimeError("canonical stock ledger unavailable; run the equities refresh first")
    now = datetime.now(timezone.utc).isoformat()
    with StockStore(path) as store:
        dataset = store.dataset(as_of=now, audience="display", freshness_days=max(days, 7))
        # Stable event identities provide downstream idempotency. Delivery progress
        # belongs to existing audit acknowledgements, never a local pre-send cursor.
        return research_events(None, dataset)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, default=stock_store_path())
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--as-of", default=datetime.now(timezone.utc).isoformat())
    args = parser.parse_args()
    if not args.store.exists():
        raise SystemExit("canonical stock ledger unavailable")
    with StockStore(args.store) as store:
        previous = json.loads(args.out.read_text()).get("display") if args.out.exists() else None
        payload = {
            "display": materialize(store, as_of=args.as_of, previous=previous),
            "export": materialize(store, as_of=args.as_of, audience="export"),
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.out.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, sort_keys=True, allow_nan=False) + "\n")
    temporary.replace(args.out)
    print(
        json.dumps(
            {
                "snapshot_id": payload["display"]["snapshot_id"],
                "facts": len(payload["display"]["facts"]),
                "withheld_sources": payload["display"]["withheld_sources"],
            }
        )
    )


if __name__ == "__main__":
    main()
