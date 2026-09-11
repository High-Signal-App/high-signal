from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest
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


def test_emit_accepts_exact_upsert_and_protected_skip(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(writer, "push_signal", lambda _candidate: {"upserts": 1})
    assert writer.emit(_candidate()) == "pushed:nvda-capacity-expansion"

    monkeypatch.setattr(writer, "push_signal", lambda _candidate: {"upserts": 0, "skipped": 1})
    assert writer.emit(_candidate()) is None
    assert not (tmp_path / "signal-recovery").exists()


@pytest.mark.parametrize(
    "response",
    [
        {"upserts": 1, "failed": 1, "skipped": 0},
        {"upserts": 0, "failed": 0, "skipped": 0},
        {"upserts": True, "failed": 0, "skipped": 0},
        {"upserts": 1, "failed": False, "skipped": 0},
        {"upserts": 1, "failed": 0, "skipped": True},
        {"upserts": 1, "failed": 0, "skipped": 1},
        ["not", "an", "object"],
        {"failed": 0, "skipped": 0},
    ],
)
def test_emit_rejects_malformed_or_failed_receipts(monkeypatch, tmp_path, response) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(writer, "push_signal", lambda _candidate: response)

    with pytest.raises(writer.SignalDeliveryError) as caught:
        writer.emit(_candidate())
    assert caught.value.slug == "nvda-capacity-expansion"
    assert caught.value.recovery_path is not None
    assert caught.value.recovery_path.parent == tmp_path / "signal-recovery"
    assert "token" not in str(caught.value)
    assert not (tmp_path / "signals").exists()


def test_http_503_writes_recovery_and_preserves_published_sentinel(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.chdir(tmp_path)
    signals_root = tmp_path / "signals"
    monkeypatch.setattr(writer, "_default_signals_root", lambda: signals_root)
    published = signals_root / "2026-08-26" / "nvda-capacity-expansion.md"
    published.parent.mkdir(parents=True)
    published.write_text("published sentinel\n", encoding="utf-8")

    transport = httpx.MockTransport(lambda _request: httpx.Response(503, text="secret token body"))
    with httpx.Client(transport=transport) as client:
        monkeypatch.setattr(writer.httpx, "post", client.post)
        with pytest.raises(writer.SignalDeliveryError) as caught:
            writer.emit(_candidate())

    assert caught.value.reason == "HTTP 503"
    assert caught.value.recovery_path is not None
    assert caught.value.recovery_path.read_text(encoding="utf-8").endswith("Supply increased.\n")
    assert published.read_text(encoding="utf-8") == "published sentinel\n"


def test_retries_retain_distinct_recovery_files(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(writer, "push_signal", lambda _candidate: {"upserts": 1, "failed": 1})

    paths = []
    for _ in range(2):
        with pytest.raises(writer.SignalDeliveryError) as caught:
            writer.emit(_candidate())
        paths.append(caught.value.recovery_path)
    assert paths[0] != paths[1]
    assert len(list((tmp_path / "signal-recovery").glob("*.md"))) == 2


def test_recovery_filename_is_bounded_and_stays_under_root(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.chdir(tmp_path)
    candidate = _candidate().model_copy(update={"slug": "../" + ("very-long-" * 50)})
    monkeypatch.setattr(writer, "push_signal", lambda _candidate: {"upserts": 0, "failed": 1})

    with pytest.raises(writer.SignalDeliveryError) as caught:
        writer.emit(candidate)
    path = caught.value.recovery_path
    assert path is not None
    assert path.parent == tmp_path / "signal-recovery"
    assert len(path.name.encode("ascii")) <= 160


def test_recovery_filesystem_error_stays_a_delivery_error(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(writer, "push_signal", lambda _candidate: {"upserts": 0, "failed": 1})
    monkeypatch.setattr(writer, "write_recovery_signal", lambda _candidate: (_ for _ in ()).throw(OSError("/secret/token")))

    with pytest.raises(writer.SignalDeliveryError) as caught:
        writer.emit(_candidate())
    assert caught.value.recovery_path is None
    assert caught.value.reason == "ValueError; recovery write failed (OSError)"
    assert "/secret" not in str(caught.value)
