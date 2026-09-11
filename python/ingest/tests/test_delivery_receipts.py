"""API delivery failures remain visible through every signal-generation path."""

from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest import pipeline, writer
from high_signal_ingest.types import EvidenceItem, Event, SignalCandidate


def _candidate(index: int) -> SignalCandidate:
    return SignalCandidate(
        slug=f"delivery-{index}",
        primary_entity_id="NVDA",
        signal_type="capacity_expansion",
        direction="neutral",
        confidence="low",
        predicted_window_days=30,
        published_at=datetime(2026, 9, 11, tzinfo=timezone.utc),
        body_md="A source-backed capacity expansion.",
        source_cluster_id=f"story-{index}",
        evidence=[
            EvidenceItem(
                url=f"https://{host}/article-{index}",
                source_type="news",
                semantic_alignment="verified",
                originating_evidence_id=f"{host}-{index}",
                role="primary" if position == 0 else "corroboration",
            )
            for position, host in enumerate(["one.example", "two.example"])
        ],
    )


@pytest.mark.parametrize("generation_path", ["large", "batch", "fallback", "thematic"])
def test_partial_delivery_preserves_success_and_fails_cli(
    monkeypatch, tmp_path, capfd, generation_path
):
    candidates = [_candidate(index) for index in range(1, 4)]
    event = Event(
        id="delivery-source",
        source="news",
        source_url="https://one.example/article",
        primary_entity_id="NVDA",
        published_at=candidates[0].published_at,
        content="Council approves a data center expansion.",
        raw_hash="source-hash",
    )
    audit_rows = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("API_BASE", "https://api.example")
    monkeypatch.setenv("ADMIN_TOKEN", "synthetic-token")
    monkeypatch.setattr(pipeline, "fetch", lambda *_, **__: [event])
    monkeypatch.setattr(pipeline.audit, "push_events", lambda *_, **__: 1)
    monkeypatch.setattr(pipeline.audit, "push_ingest_run", lambda **row: audit_rows.append(row))
    monkeypatch.setattr(pipeline, "load_retained_corroboration", lambda _: ([], {}))
    monkeypatch.setattr(pipeline, "_spillover_candidates", lambda _: [])
    clusters = [("NVDA", [event])] * 3
    monkeypatch.setattr(
        pipeline,
        "_pre_group_clusters",
        lambda _: (
            clusters if generation_path in {"large", "fallback"} else [],
            [clusters] if generation_path == "batch" else [],
            0,
        ),
    )
    generated = iter(candidates)
    monkeypatch.setattr(pipeline, "generate", lambda *_, **__: next(generated))
    monkeypatch.setattr(pipeline, "generate_batch", lambda _: candidates)
    if generation_path == "fallback":
        monkeypatch.setattr(pipeline, "generate", lambda *_, **__: None)
        monkeypatch.setattr(pipeline, "_fallback_drafts_enabled", lambda: True)
        monkeypatch.setattr(pipeline, "fallback_candidate", lambda *_, **__: next(generated))
    else:

        def unexpected_fallback(*_, **__):
            raise AssertionError("delivery failure triggered weaker fallback generation")

        monkeypatch.setattr(pipeline, "fallback_candidate", unexpected_fallback)
    if generation_path == "thematic":
        from high_signal_ingest import grouping, thematic

        monkeypatch.setattr(pipeline, "_event_entity", lambda _: None)
        other = event.model_copy(
            update={
                "id": "second-source",
                "source": "legistar",
                "source_url": "https://two.example/article",
                "raw_hash": "other-hash",
            }
        )
        monkeypatch.setattr(grouping, "classify_themes", lambda _: ["data-center-buildout"])
        monkeypatch.setattr(thematic, "buildout_stories", lambda _: [[event, other]] * 3)
    else:
        monkeypatch.setattr(pipeline, "_emit_thematic_drafts", lambda *_, **__: [])

    responses = iter(
        [
            httpx.Response(200, json={"upserts": 1, "skipped": 0, "failed": 0}),
            httpx.Response(503, text="synthetic private error body"),
            httpx.Response(200, json={"upserts": 0, "skipped": 1, "failed": 0}),
        ]
    )
    with httpx.Client(transport=httpx.MockTransport(lambda _: next(responses))) as client:
        monkeypatch.setattr(writer.httpx, "post", client.post)
        result = pipeline.run("ir", 1)

    assert result["paths"] == ["pushed:delivery-1"]
    assert result["signals_drafted"] == 1
    assert result["signals_delivery_failed"] == result["errors"] == 1
    assert result["signals_recovered"] == 1
    files = list((tmp_path / "signal-recovery").glob("*.md"))
    assert result["recovery_paths"] == [str(files[0])]
    assert len(files) == 1
    assert "slug: delivery-2" in files[0].read_text()
    assert audit_rows[-1]["signals_drafted"] == 1
    assert audit_rows[-1]["errors"] == 1
    assert "HTTP 503" in audit_rows[-1]["error_sample"]
    assert "signals_recovered=1" in audit_rows[-1]["notes"]
    assert "synthetic private error body" not in str(audit_rows)

    monkeypatch.setattr(pipeline, "run", lambda *_, **__: result)
    monkeypatch.setattr(pipeline.sys, "argv", ["pipeline", "--source", "ir", "--json"])
    with pytest.raises(SystemExit) as caught:
        pipeline.main()
    assert caught.value.code == 4
    assert "signal delivery failed" in capfd.readouterr().err


def test_attention_generation_propagates_delivery_failure(monkeypatch, tmp_path):
    candidate = _candidate(1)
    monkeypatch.setattr(pipeline, "_pre_group_clusters", lambda _: ([("NVDA", [])], [], 0))
    monkeypatch.setattr(pipeline, "generate", lambda *_: candidate)
    failure = writer.SignalDeliveryError(candidate.slug, "HTTP 503", tmp_path / "recovery.md")

    def fail(_):
        raise failure

    monkeypatch.setattr(pipeline, "emit", fail)
    with pytest.raises(writer.SignalDeliveryError) as caught:
        pipeline.cluster_and_generate([], allow_fallback=False)
    assert caught.value is failure
