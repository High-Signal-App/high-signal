"""Editorial adapter over validated datasets. No collection or valuation logic."""

from __future__ import annotations

from datetime import datetime

from .stock_data.models import content_id
from .stock_data.valuation import detect_changes
from .types import Event, SourceDocument


def research_events(previous: dict | None, current: dict) -> list[Event]:
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
                    published_at=published_at,
                    raw_hash=evidence["sha256"],
                    raw_json=payload,
                    parsed_fields={"stockData": payload, "originatingEvidenceId": origin_id},
                ),
            )
        )
    return out
