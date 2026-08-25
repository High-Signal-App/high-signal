from __future__ import annotations

from datetime import datetime, timezone

import yaml

from high_signal_ingest import writer
from high_signal_ingest.types import EvidenceItem, SignalCandidate


def _candidate() -> SignalCandidate:
    return SignalCandidate(
        slug="nvda-capacity-expansion",
        signal_type="capacity_change",
        primary_entity_id="NVDA",
        direction="up",
        confidence="high",
        predicted_window_days=30,
        published_at=datetime(2026, 8, 26, tzinfo=timezone.utc),
        evidence=[
            EvidenceItem(
                url="https://one.example/a",
                source_type="news",
                source_document_key="news:one:https://one.example/a",
                originating_evidence_id="announcement-1",
                semantic_alignment="verified",
                role="primary",
                supports=["observed_event"],
            ),
            EvidenceItem(
                url="https://two.example/b",
                source_type="filing",
                source_document_key="filing:https://two.example/b",
                originating_evidence_id="filing-2",
                semantic_alignment="verified",
                role="corroboration",
                supports=["observed_event", "direct_entity_impact"],
            ),
        ],
        body_md="## What changed\nCapacity expanded.\n\n## Why it matters\nSupply increased.",
        observed_event="NVIDIA expanded accelerator capacity.",
        direct_entity_impact="More sellable capacity.",
        claim_event="capacity expansion",
        claim_amount="20 percent",
        claim_date="2026-08-26",
    )


def test_write_signal_preserves_claim_and_proof_receipts(tmp_path) -> None:
    path = writer.write_signal(_candidate(), root=tmp_path)
    frontmatter = yaml.safe_load(path.read_text(encoding="utf-8").split("---", 2)[1])

    assert frontmatter["claim_assertion"] == "NVIDIA expanded accelerator capacity."
    assert frontmatter["claim_event"] == "capacity expansion"
    assert frontmatter["claim_amount"] == "20 percent"
    assert frontmatter["claim_date"] == "2026-08-26"
    assert frontmatter["claim_direction"] == "up"
    assert frontmatter["proof_roles"] == ["primary", "corroboration"]
    assert frontmatter["proof_originating_evidence_ids"][1] == "filing-2"


def test_push_signal_sends_structured_claim_and_proofs(monkeypatch) -> None:
    captured: dict = {}

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"upserts": 1, "proofUpserts": 1}

    def fake_post(_url, **kwargs):
        captured.update(kwargs["json"])
        return Response()

    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.setattr(writer.httpx, "post", fake_post)

    result = writer.push_signal(_candidate())
    signal = captured["signals"][0]

    assert result["proofUpserts"] == 1
    assert signal["claim"]["event"] == "capacity expansion"
    assert signal["evidence"][0]["semanticAlignment"] == "verified"
    assert signal["evidence"][1]["role"] == "corroboration"
    assert signal["evidence"][1]["supports"] == [
        "observed_event",
        "direct_entity_impact",
    ]
