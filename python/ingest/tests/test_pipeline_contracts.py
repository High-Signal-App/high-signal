"""Contract tests for signal generation gates."""

from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import generator, pipeline
from high_signal_ingest.types import Event, SignalCandidate, SourceDocument


def _event(
    source_url: str,
    entity_id: str = "NVDA",
    *,
    title: str = "NVIDIA lead times changed",
    source: str = "news:test",
) -> Event:
    return Event(
        id=source_url.rsplit("/", 1)[-1],
        source=source,
        source_url=source_url,
        published_at=datetime(2026, 4, 25, tzinfo=timezone.utc),
        title=title,
        content="NVIDIA B200 lead times changed materially.",
        primary_entity_id=entity_id,
        raw_hash=source_url,
        source_document=SourceDocument(document_key=f"{source}:{source_url}"),
    )


def test_json_parser_recovers_literal_control_characters_only() -> None:
    assert generator._parse_json_message('{"body_md":"line one\nline two"}') == {
        "body_md": "line one\nline two"
    }


def test_cluster_retains_single_origin_without_generating_signal(monkeypatch) -> None:
    calls = 0

    def fake_generate(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return None

    monkeypatch.setattr(pipeline, "generate", fake_generate)
    monkeypatch.setattr(pipeline, "_emit_fallback_drafts", lambda *_args, **_kwargs: [])

    assert pipeline.cluster_and_generate([_event("https://example.com/a")]) == []
    assert calls == 0


def test_cluster_emits_fallback_when_generation_is_empty(monkeypatch) -> None:
    emitted: list[SignalCandidate] = []

    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setattr(pipeline, "generate", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pipeline, "emit", lambda c: emitted.append(c) or f"draft:{c.slug}")

    paths = pipeline.cluster_and_generate(
        [
            _event("https://example.com/a", source="news:one"),
            _event("https://another.example/b", source="news:two"),
        ]
    )

    assert paths == ["draft:nvda-nvidia-lead-times-changed"]
    assert emitted[0].confidence == "medium"
    assert emitted[0].evidence[0].url == "https://example.com/a"


def test_cluster_does_not_emit_fallback_after_ai_rejection(monkeypatch) -> None:
    monkeypatch.setenv("AI_API_KEY", "configured")
    monkeypatch.setattr(pipeline, "generate", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        pipeline,
        "_emit_fallback_drafts",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("fallback emitted")),
    )

    paths = pipeline.cluster_and_generate(
        [
            _event("https://example.com/a", source="news:one"),
            _event("https://another.example/b", source="news:two"),
        ]
    )

    assert paths == []


def test_cluster_does_not_emit_ai_candidate_without_verified_origins(monkeypatch) -> None:
    events = [
        _event("https://example.com/a", source="news:one"),
        _event("https://another.example/b", source="news:two"),
    ]
    candidate = generator.fallback_candidate("NVDA", events, [])
    assert candidate is not None

    monkeypatch.setenv("AI_API_KEY", "configured")
    monkeypatch.setattr(pipeline, "generate", lambda *_args, **_kwargs: candidate)
    monkeypatch.setattr(
        pipeline,
        "emit",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("candidate emitted")),
    )

    assert pipeline.cluster_and_generate(events) == []


def test_publishable_proofs_require_independent_providers() -> None:
    candidate = generator.fallback_candidate(
        "NVDA",
        [
            _event("https://job-boards.example/jobs/one", source="jobs:one"),
            _event("https://job-boards.example/jobs/two", source="jobs:two"),
        ],
        [],
    )
    assert candidate is not None
    candidate.evidence[0].semantic_alignment = "verified"
    candidate.evidence[0].role = "primary"
    candidate.evidence[0].originating_evidence_id = "job-one"
    candidate.evidence[1].semantic_alignment = "verified"
    candidate.evidence[1].role = "corroboration"
    candidate.evidence[1].originating_evidence_id = "job-two"

    assert pipeline._has_publishable_proofs(candidate) is False

    candidate.evidence[1].url = "https://independent.example/report"
    assert pipeline._has_publishable_proofs(candidate) is True


def test_cluster_separates_unrelated_stories_for_same_entity(monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_generate(_entity_id, events, _spillovers):
        calls.append([event.source_url for event in events])
        return None

    monkeypatch.setattr(pipeline, "generate", fake_generate)
    monkeypatch.setattr(pipeline, "_emit_fallback_drafts", lambda *_args, **_kwargs: [])

    pipeline.cluster_and_generate(
        [
            _event("https://one.example/a", source="news:one"),
            _event("https://two.example/b", source="news:two"),
            _event(
                "https://three.example/c",
                source="news:three",
                title="NVIDIA opens a new research office",
            ),
        ]
    )

    assert calls == [["https://one.example/a", "https://two.example/b"]]


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
                "body_md": "Body cites https://example.com/a.",
            },
            {
                "model": "test",
                "prompt_version": "0",
                "reason": None,
                "raw_response": None,
                "latency_ms": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        ),
    )

    cand = generator.generate("NVDA", [_event("https://example.com/a")], [])

    assert cand is not None
    assert cand.signal_type == "credit_facility_update"
    assert [e.url for e in cand.evidence] == ["https://example.com/a"]


def test_generator_drops_uncited_cluster_events(monkeypatch) -> None:
    monkeypatch.setattr(
        generator,
        "_ai_complete",
        lambda *_args, **_kwargs: (
            {
                "publish": True,
                "signal_type": "design_win",
                "direction": "up",
                "confidence": "medium",
                "predicted_window_days": 60,
                "spillover_entity_ids": [],
                "headline": "NVIDIA design win",
                "body_md": "The supported claim cites https://example.com/a.",
            },
            {
                "model": "test",
                "prompt_version": "0",
                "reason": None,
                "raw_response": None,
                "latency_ms": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        ),
    )

    cand = generator.generate(
        "NVDA",
        [_event("https://example.com/a"), _event("https://example.com/adjacent")],
        [],
    )

    assert cand is not None
    assert [e.url for e in cand.evidence] == ["https://example.com/a"]


def test_generator_preserves_valid_structured_proof_when_body_omits_url(monkeypatch) -> None:
    url = "https://example.com/a"
    monkeypatch.setattr(
        generator,
        "_ai_complete",
        lambda *_args, **_kwargs: (
            {
                "publish": True,
                "signal_type": "design_win",
                "direction": "up",
                "confidence": "medium",
                "predicted_window_days": 60,
                "spillover_entity_ids": [],
                "headline": "NVIDIA design win",
                "proofs": [
                    {
                        "url": url,
                        "aligned": True,
                        "originating_evidence_id": "announcement-1",
                        "supports": ["observed_event"],
                    },
                    {
                        "url": "https://hallucinated.example/not-supplied",
                        "aligned": True,
                        "originating_evidence_id": "not-supplied",
                        "supports": ["observed_event"],
                    },
                ],
                "body_md": "The company announced a supported design win.",
            },
            {
                "model": "test",
                "prompt_version": "0",
                "reason": None,
                "raw_response": None,
                "latency_ms": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        ),
    )

    candidate = generator.generate("NVDA", [_event(url)], [])

    assert candidate is not None
    assert [item.url for item in candidate.evidence] == [url]
    assert candidate.evidence[0].semantic_alignment == "verified"
    assert candidate.evidence[0].originating_evidence_id == "announcement-1"
    assert candidate.body_md.endswith(f"## Proofs\n- <{url}>\n")


def test_generator_records_distinct_verified_proof_origins(monkeypatch) -> None:
    urls = ["https://one.example/a", "https://two.example/b", "https://three.example/c"]
    monkeypatch.setattr(
        generator,
        "_ai_complete",
        lambda *_args, **_kwargs: (
            {
                "publish": True,
                "signal_type": "capacity_change",
                "direction": "up",
                "confidence": "high",
                "predicted_window_days": 30,
                "spillover_entity_ids": [],
                "headline": "NVIDIA capacity changed",
                "claim_event": "capacity expansion",
                "claim_date": "2026-04-25",
                "observed_event": "NVIDIA expanded capacity.",
                "proofs": [
                    {
                        "url": urls[0],
                        "aligned": True,
                        "originating_evidence_id": "announcement-1",
                        "supports": ["observed_event"],
                    },
                    {
                        "url": urls[1],
                        "aligned": True,
                        "originating_evidence_id": "announcement-1",
                        "supports": ["observed_event"],
                    },
                    {
                        "url": urls[2],
                        "aligned": True,
                        "originating_evidence_id": "filing-2",
                        "supports": ["observed_event", "direct_entity_impact"],
                    },
                ],
                "body_md": " ".join(urls),
            },
            {
                "model": "test",
                "prompt_version": "0",
                "reason": None,
                "raw_response": None,
                "latency_ms": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        ),
    )

    candidate = generator.generate(
        "NVDA",
        [
            _event(urls[0], source="news:one"),
            _event(urls[1], source="news:two"),
            _event(urls[2], source="news:three"),
        ],
        [],
    )

    assert candidate is not None
    assert [item.role for item in candidate.evidence] == ["primary", "context", "corroboration"]
    assert all(item.semantic_alignment == "verified" for item in candidate.evidence)
    assert candidate.claim_event == "capacity expansion"
    assert candidate.evidence[2].supports == ["observed_event", "direct_entity_impact"]


def test_batch_generation_keeps_two_stories_for_the_same_entity_distinct(monkeypatch) -> None:
    urls = ["https://one.example/a", "https://two.example/b"]
    monkeypatch.setattr(
        generator,
        "_ai_complete",
        lambda *_args, **_kwargs: (
            [
                {
                    "cluster_id": "story-1",
                    "entity_id": "NVDA",
                    "publish": True,
                    "signal_type": "capacity_change",
                    "direction": "up",
                    "confidence": "medium",
                    "headline": "Capacity changed",
                    "body_md": urls[0],
                },
                {
                    "cluster_id": "story-2",
                    "entity_id": "NVDA",
                    "publish": True,
                    "signal_type": "research_expansion",
                    "direction": "neutral",
                    "confidence": "medium",
                    "headline": "Research expanded",
                    "body_md": urls[1],
                },
            ],
            {
                "model": "test",
                "prompt_version": "0",
                "reason": None,
                "raw_response": None,
                "latency_ms": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        ),
    )

    candidates = generator.generate_batch(
        [
            ("NVDA", [_event(urls[0])], []),
            (
                "NVDA",
                [_event(urls[1], title="NVIDIA opens a new research office")],
                [],
            ),
        ]
    )

    assert [candidate.source_cluster_id for candidate in candidates] == ["story-1", "story-2"]
    assert [[e.url for e in candidate.evidence] for candidate in candidates] == [
        [urls[0]],
        [urls[1]],
    ]


def test_batch_generation_preserves_structured_proof_when_body_omits_url(monkeypatch) -> None:
    url = "https://one.example/a"
    monkeypatch.setattr(
        generator,
        "_ai_complete",
        lambda *_args, **_kwargs: (
            [
                {
                    "cluster_id": "story-1",
                    "entity_id": "NVDA",
                    "publish": True,
                    "signal_type": "capacity_change",
                    "direction": "up",
                    "confidence": "medium",
                    "headline": "Capacity changed",
                    "proofs": [
                        {
                            "url": url,
                            "aligned": True,
                            "originating_evidence_id": "filing-1",
                            "supports": ["observed_event"],
                        }
                    ],
                    "body_md": "NVIDIA expanded capacity.",
                }
            ],
            {
                "model": "test",
                "prompt_version": "0",
                "reason": None,
                "raw_response": None,
                "latency_ms": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            },
        ),
    )

    candidates = generator.generate_batch([("NVDA", [_event(url)], [])])

    assert len(candidates) == 1
    assert [item.url for item in candidates[0].evidence] == [url]
    assert candidates[0].body_md.endswith(f"## Proofs\n- <{url}>\n")


def test_generation_prompt_requires_brief_editorial_sections() -> None:
    prompt = generator._prompt()
    assert "## What changed" in prompt
    assert "## Why it matters" in prompt
    assert "## Uncertainty" in prompt


def test_batch_prompt_matches_json_object_response_contract() -> None:
    prompt = generator._batch_prompt()
    assert '"signals": [' in prompt
    assert "Return a JSON object" in prompt
    assert "Return a JSON ARRAY" not in prompt
