"""Contract tests for signal generation gates."""

from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import generator, pipeline
from high_signal_ingest.types import Event, SignalCandidate


def _event(source_url: str, entity_id: str = "NVDA") -> Event:
    return Event(
        id=source_url.rsplit("/", 1)[-1],
        source="news:test",
        source_url=source_url,
        published_at=datetime(2026, 4, 25, tzinfo=timezone.utc),
        title="NVIDIA lead times changed",
        content="NVIDIA B200 lead times changed materially.",
        primary_entity_id=entity_id,
        raw_hash=source_url,
    )


def test_cluster_sends_single_source_to_generator(monkeypatch) -> None:
    calls = 0

    def fake_generate(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return None

    monkeypatch.setattr(pipeline, "generate", fake_generate)
    monkeypatch.setattr(pipeline, "_emit_fallback_drafts", lambda *_args, **_kwargs: [])

    assert pipeline.cluster_and_generate([_event("https://example.com/a")]) == []
    assert calls == 1


def test_cluster_emits_fallback_when_generation_is_empty(monkeypatch) -> None:
    emitted: list[SignalCandidate] = []

    monkeypatch.setattr(pipeline, "generate", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pipeline, "emit", lambda c: emitted.append(c) or f"draft:{c.slug}")

    paths = pipeline.cluster_and_generate([_event("https://example.com/a")])

    assert paths == ["draft:nvda-nvidia-lead-times-changed"]
    assert emitted[0].confidence == "low"
    assert emitted[0].evidence[0].url == "https://example.com/a"


def test_generator_accepts_dynamic_signal_type(monkeypatch) -> None:
    monkeypatch.setenv("AI_BASE_URL", "https://ai.example")
    monkeypatch.setenv("AI_API_KEY", "test")
    monkeypatch.setattr(
        generator,
        "_ai_complete",
        lambda *_args, **_kwargs: (
            {
                "publish": True,
                "signal_type": "Credit Facility Update",
                "direction": "up",
                "confidence": "medium",
                "predicted_window_days": 20,
                "spillover_entity_ids": [],
                "headline": "NVIDIA capex signal",
                "body_md": "Body",
            },
            {"model": "test", "prompt_version": "0", "reason": None, "raw_response": None,
             "latency_ms": 0, "tokens_in": 0, "tokens_out": 0},
        ),
    )

    cand = generator.generate("NVDA", [_event("https://example.com/a")], [])

    assert cand is not None
    assert cand.signal_type == "credit_facility_update"
