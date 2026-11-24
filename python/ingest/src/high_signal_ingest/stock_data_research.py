"""Editorial adapter over validated datasets. No collection or valuation logic."""

from __future__ import annotations

from datetime import datetime

from .stock_data.models import content_id, decimal_value
from .stock_data.valuation import detect_changes
from .types import Event, SourceDocument


def research_events(
    previous: dict | None,
    current: dict,
    *,
    valuation_windows: dict[str, tuple[dict, dict]] | None = None,
) -> list[Event]:
    """Keep one original evidence origin per event; a finding is not corroboration."""
    if current.get("audience") != "display":
        raise ValueError("editorial inputs require permitted display rights")
    stale = set(current.get("stale_fact_ids", []))
    documents = {item["id"]: item for item in current.get("evidence", [])}
    grouped: dict[tuple[str, str], list[dict]] = {}
    for change in detect_changes(previous, current):
        fact = change["after"]
        if fact is None or fact.get("status") != "available" or fact["id"] in stale:
            continue
        if fact["entity_id"].startswith("currency:"):
            continue
        document = documents.get(fact["evidence_id"])
        if not document:
            raise ValueError("changed fact lacks retained evidence")
        grouped.setdefault((fact["entity_id"], document["url"]), []).append(change)
    out = []
    for (entity_id, source_url), changes in sorted(grouped.items()):
        facts = [item["after"] for item in changes]
        evidence_ids = sorted({f["evidence_id"] for f in facts})
        original_evidence = [documents[key] for key in evidence_ids]
        evidence = original_evidence[0]
        origin_id = content_id("origin", [evidence["source_id"], source_url])
        payload = {
            "contractVersion": current["contract_version"],
            "inputSnapshotId": current["snapshot_id"],
            "facts": facts,
            "changes": changes,
            "evidence": original_evidence,
            "classification": "numerical_observation",
            "investmentConclusion": None,
        }
        raw_hash = content_id(
            "research", [entity_id, source_url, sorted(f["id"] for f in facts)]
        ).split(":", 1)[1]
        document_key, valuation_change = _filing_receipt(
            facts, original_evidence, origin_id, raw_hash, valuation_windows or {}
        )
        if valuation_change is not None:
            payload["listedCoverageChange"] = valuation_change
        content = "\n".join(
            f"{f['metric']}: {f['value']} {f['unit']} (effective {f['effective_at']}; publicly available {f['available_at']}; locator {f['locator']}; input {f['id']})"
            for f in facts
        )
        published_at = datetime.fromisoformat(
            max(f["available_at"] for f in facts).replace("Z", "+00:00")
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"{evidence['source_id']}:{entity_id.lower()}",
                source_url=evidence["url"],
                published_at=published_at,
                title=f"Disclosed financial facts changed: {entity_id}",
                content=content,
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=evidence["url"],
                    document_key=document_key,
                    published_at=published_at,
                    raw_hash=evidence["sha256"],
                    raw_json=payload,
                    parsed_fields={"stockData": payload, "originatingEvidenceId": origin_id},
                ),
            )
        )
    return out


def _filing_receipt(
    facts: list[dict],
    evidence: list[dict],
    origin_id: str,
    raw_hash: str,
    windows: dict[str, tuple[dict, dict]],
) -> tuple[str | None, dict | None]:
    if len(evidence) != 1 or not any(fact["metric"] == "shares_owned" for fact in facts):
        return None, None
    document = evidence[0]
    key = content_id("stock-filing", [origin_id, document["sha256"], raw_hash])
    if any(
        fact["metric"] == "shares_owned" and fact["available_at"] != document["available_at"]
        for fact in facts
    ):
        return key, None
    return key, _filing_valuation_change(facts[0]["entity_id"], facts, windows)


def _filing_valuation_change(
    entity_id: str,
    event_facts: list[dict],
    windows: dict[str, tuple[dict, dict]],
) -> dict | None:
    holdings = [fact for fact in event_facts if fact["metric"] == "shares_owned"]
    filing_times = {fact["available_at"] for fact in holdings}
    if len(filing_times) != 1:
        return None
    window = windows.get(next(iter(filing_times)))
    if not window:
        return None
    previous, current = window

    # Both projections used the same current rights in one local transaction.
    current_rights = {
        right["id"]: right["public_display"]
        for projection in (previous, current)
        for right in projection.get("usage_rights", [])
    }
    permitted = {
        source for source, permission in current_rights.items() if permission == "permitted"
    }
    before = _listed_coverage(previous, entity_id, permitted)
    after = _listed_coverage(current, entity_id, permitted)
    if not before or not after or not _comparable_coverage(before, after):
        return None

    changed_holding_ids = _changed_holdings(
        previous["facts"], current["facts"], set(before["inputFactIds"]), set(after["inputFactIds"])
    )
    if not changed_holding_ids or set(changed_holding_ids) - {fact["id"] for fact in holdings}:
        return None
    return {
        "method": "listed_coverage",
        "before": before,
        "after": after,
        "changedHoldingFactIds": changed_holding_ids,
    }


def _comparable_coverage(before: dict, after: dict) -> bool:
    return all(
        before[key] == after[key] for key in ("componentIds", "currency", "modelVersion")
    ) and (
        decimal_value(before["listedInvestmentCoverage"])
        != decimal_value(after["listedInvestmentCoverage"])
    )


def _changed_holdings(
    previous: list[dict], current: list[dict], before_ids: set[str], after_ids: set[str]
) -> list[str]:
    before = _holding_inputs(previous, before_ids)
    after = _holding_inputs(current, after_ids)
    if not before or not after or before.keys() != after.keys():
        return []
    if before_ids - {fact["id"] for fact in before.values()} != (
        after_ids - {fact["id"] for fact in after.values()}
    ):
        return []
    return sorted(
        fact["id"]
        for key, fact in after.items()
        if decimal_value(before[key]["value"]) != decimal_value(fact["value"])
    )


def _holding_inputs(facts: list[dict], input_ids: set[str]) -> dict[tuple, dict]:
    holdings = {}
    for fact in facts:
        if fact["id"] not in input_ids or fact["metric"] != "shares_owned":
            continue
        dimensions = fact["dimensions"]
        key = (
            fact["entity_id"],
            dimensions.get("asset_entity_id"),
            dimensions.get("security_id"),
            dimensions.get("share_basis"),
            fact["unit"],
        )
        if not all(key) or key in holdings:
            return {}
        holdings[key] = fact
    return holdings


def _listed_coverage(dataset: dict, entity_id: str, permitted: set[str]) -> dict | None:
    result = next(
        (item for item in dataset.get("valuations", []) if item["parent_entity_id"] == entity_id),
        None,
    )
    if not result or (
        result["method"] != "listed_coverage"
        or result["freshness"] != "fresh"
        or result["listed_investment_coverage"] is None
        or result["missing_holding_fact_ids"]
        or tuple(result["input_snapshot_ids"]) != (dataset["snapshot_id"],)
    ):
        return None
    facts = {fact["id"]: fact for fact in dataset["facts"]}
    evidence = {document["id"]: document for document in dataset["evidence"]}
    input_ids = set(result["input_fact_ids"])
    if input_ids & set(dataset["stale_fact_ids"]) or not input_ids <= facts.keys():
        return None
    evidence_ids = {facts[fact_id]["evidence_id"] for fact_id in input_ids}
    if any(
        key not in evidence or evidence[key]["source_id"] not in permitted for key in evidence_ids
    ):
        return None
    return {
        "valuationSnapshotId": result["snapshot_id"],
        "inputSnapshotId": dataset["snapshot_id"],
        "modelVersion": result["model_version"],
        "inputFactIds": sorted(input_ids),
        "inputEvidenceIds": sorted(evidence_ids),
        "componentIds": sorted(line["interest_id"] for line in result["components"]),
        "asOf": result["as_of"],
        "currency": result["currency"],
        "listedInvestmentCoverage": result["listed_investment_coverage"],
    }
