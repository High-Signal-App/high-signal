"""Contract tests for signal generation gates."""

from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import generator, pipeline
from high_signal_ingest.types import EvidenceItem, Event, SignalCandidate, SourceDocument


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


def test_cluster_can_forbid_review_fallback_for_attention_verification(monkeypatch) -> None:
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
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
        ],
        allow_fallback=False,
    )

    assert paths == []


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


def _proof(
    url: str,
    *,
    source_type: str,
    origin: str | None,
    alignment: str = "verified",
    role: str = "primary",
) -> EvidenceItem:
    return EvidenceItem(
        url=url,
        source_type=source_type,
        originating_evidence_id=origin,
        semantic_alignment=alignment,
        role=role,
    )


def _candidate(evidence: list[EvidenceItem]) -> SignalCandidate:
    return SignalCandidate(
        slug="nvda-proof-gate",
        signal_type="filing",
        primary_entity_id="NVDA",
        direction="up",
        confidence="medium",
        predicted_window_days=30,
        published_at=datetime(2026, 8, 29, tzinfo=timezone.utc),
        evidence=evidence,
        body_md="body",
    )


def test_two_authoritative_origins_on_one_host_are_corroboration() -> None:
    """Two independent SEC filings both live on sec.gov and must not be rejected."""
    candidate = _candidate(
        [
            _proof(
                "https://www.sec.gov/Archives/edgar/data/1045810/8-k.htm",
                source_type="edgar",
                origin="edgar-8k",
            ),
            _proof(
                "https://data.sec.gov/api/xbrl/frames/Revenues.json",
                source_type="sec-xbrl",
                origin="xbrl-frame",
                role="corroboration",
            ),
        ]
    )
    verdict = pipeline._proof_verdict(candidate)
    assert verdict.distinct_providers == 1
    assert verdict.authoritative_only is True
    assert verdict.reason == "proofs_verified"
    assert pipeline._has_publishable_proofs(candidate) is True


def test_single_origin_still_fails_on_authoritative_sources() -> None:
    candidate = _candidate(
        [
            _proof(
                "https://www.sec.gov/Archives/edgar/data/1045810/8-k.htm",
                source_type="edgar",
                origin="edgar-8k",
            ),
            _proof(
                "https://www.sec.gov/Archives/edgar/data/1045810/8-k-exhibit.htm",
                source_type="edgar",
                origin="edgar-8k",
                role="corroboration",
            ),
        ]
    )
    assert pipeline._proof_verdict(candidate).reason == "single_evidentiary_origin"
    assert pipeline._has_publishable_proofs(candidate) is False


def test_one_verified_proof_plus_context_still_fails() -> None:
    candidate = _candidate(
        [
            _proof(
                "https://www.sec.gov/Archives/edgar/data/1045810/8-k.htm",
                source_type="edgar",
                origin="edgar-8k",
            ),
            _proof(
                "https://blog.example/commentary",
                source_type="news",
                origin="commentary",
                role="context",
            ),
        ]
    )
    assert pipeline._proof_verdict(candidate).reason == "single_evidentiary_origin"
    assert pipeline._has_publishable_proofs(candidate) is False


def test_unverified_proofs_still_fail() -> None:
    candidate = _candidate(
        [
            _proof(
                "https://www.sec.gov/Archives/edgar/data/1045810/8-k.htm",
                source_type="edgar",
                origin="edgar-8k",
                alignment="unverified",
            ),
            _proof(
                "https://data.sec.gov/api/xbrl/frames/Revenues.json",
                source_type="sec-xbrl",
                origin="xbrl-frame",
                alignment="unverified",
                role="corroboration",
            ),
        ]
    )
    assert pipeline._proof_verdict(candidate).reason == "single_evidentiary_origin"
    assert pipeline._has_publishable_proofs(candidate) is False


def test_news_family_still_requires_distinct_hosts() -> None:
    """Demoting the host clause is scoped to authoritative providers only."""
    candidate = _candidate(
        [
            _proof("https://news.example/one", source_type="news", origin="story-one"),
            _proof(
                "https://news.example/two",
                source_type="news",
                origin="story-two",
                role="corroboration",
            ),
        ]
    )
    assert pipeline._proof_verdict(candidate).reason == "single_provider"
    assert pipeline._has_publishable_proofs(candidate) is False


def test_proof_tally_counts_generation_and_rejection_reasons() -> None:
    tally = pipeline.new_proof_tally()
    assert set(tally) == set(pipeline.PROOF_TALLY_KEYS)
    assert all(value == 0 for value in tally.values())

    passing = _candidate(
        [
            _proof("https://www.sec.gov/a", source_type="edgar", origin="one"),
            _proof("https://data.sec.gov/b", source_type="sec-xbrl", origin="two"),
        ]
    )
    rejected = _candidate(
        [
            _proof("https://news.example/one", source_type="news", origin="same"),
            _proof("https://news.example/two", source_type="news", origin="same"),
        ]
    )
    assert pipeline.record_proof(passing, tally) is True
    assert pipeline.record_proof(rejected, tally) is False

    assert tally["candidates_generated"] == 2
    assert tally["candidates_rejected_no_proof"] == 1
    assert tally["candidates_rejected_single_evidentiary_origin"] == 1
    assert tally["candidates_admitted_single_provider_authoritative"] == 1


def test_zero_draft_alert_fires_only_on_a_silent_drought() -> None:
    alert = pipeline.zero_draft_alert(
        {
            "events": 2274,
            "signals_drafted": 0,
            "errors": 0,
            "candidates_generated": 40,
            "candidates_rejected_no_proof": 40,
            "events_low_cluster": 523,
            "events_no_entity": 1587,
        }
    )
    assert alert is not None
    assert alert.startswith("::warning title=zero signal drafts::")
    assert "rejected_no_proof=40" in alert

    assert pipeline.zero_draft_alert({"events": 2274, "signals_drafted": 3}) is None
    assert pipeline.zero_draft_alert({"events": 0, "signals_drafted": 0}) is None


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


def test_zero_draft_alert_reports_clusters_reaching_generation() -> None:
    """`candidates_generated: 2` reads the same whether generation saw 2
    clusters or 40. The receipt has to say which."""
    alert = pipeline.zero_draft_alert(
        {
            "events": 3560,
            "signals_drafted": 0,
            "errors": 1,
            "clusters_reaching_generation": 37,
            "candidates_generated": 2,
            "candidates_rejected_no_proof": 2,
            "events_low_cluster": 479,
            "events_no_entity": 2065,
        }
    )
    assert alert is not None
    assert "clusters=37" in alert
    assert "generated=2" in alert


def test_generation_outage_alert_ignores_thematic_fallback_drafts() -> None:
    alert = pipeline.generation_outage_alert(
        {
            "signals_drafted": 1,
            "clusters_reaching_generation": 36,
            "generation_requests": 13,
            "generation_request_failures": 13,
            "candidates_generated": 0,
        }
    )

    assert alert is not None
    assert "all 13 AI generation request(s) failed" in alert


def test_generation_outage_alert_allows_declines_and_partial_recovery() -> None:
    assert (
        pipeline.generation_outage_alert(
            {"generation_requests": 5, "generation_request_failures": 4}
        )
        is None
    )
    assert (
        pipeline.generation_outage_alert(
            {"generation_requests": 5, "generation_request_failures": 0}
        )
        is None
    )


def test_run_receipt_reports_clusters_reaching_generation(monkeypatch) -> None:
    """The counter is sourced from `_pre_group_clusters`, before generation."""
    monkeypatch.setattr(pipeline, "fetch", lambda *_a, **_k: [])
    monkeypatch.setattr(pipeline.audit, "push_events", lambda *_a, **_k: 0)
    monkeypatch.setattr(pipeline.audit, "push_ingest_run", lambda **_k: None)
    monkeypatch.setattr(pipeline.audit, "push_ingest_runs", lambda *_a, **_k: None)

    seen: list[tuple[str, list]] = []

    def fake_pre_group(_by_entity):
        clusters = [("NVDA", []), ("AMD", [])]
        return [clusters[0]], [[clusters[1]]], 17

    monkeypatch.setattr(pipeline, "_pre_group_clusters", fake_pre_group)
    monkeypatch.setattr(pipeline, "generate", lambda *_a, **_k: seen.append(("large", [])) or None)
    monkeypatch.setattr(pipeline, "generate_batch", lambda *_a, **_k: [])
    monkeypatch.setattr(pipeline, "_emit_fallback_drafts", lambda *_a, **_k: [])
    monkeypatch.setattr(pipeline, "_emit_thematic_drafts", lambda *_a, **_k: [])

    out = pipeline.run("all", 1)
    assert out["clusters_reaching_generation"] == 2
    assert out["generation_requests"] == 2
    assert out["generation_request_failures"] == 0
    assert out["events_low_cluster"] == 17
    assert out["candidates_generated"] == 0


def test_fetch_only_receipt_carries_the_cluster_counter(monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "fetch", lambda *_a, **_k: [])
    monkeypatch.setattr(pipeline.audit, "push_events", lambda *_a, **_k: 0)
    monkeypatch.setattr(pipeline.audit, "push_ingest_run", lambda **_k: None)
    monkeypatch.setattr(pipeline.audit, "push_ingest_runs", lambda *_a, **_k: None)

    out = pipeline.run("all", 1, generate_signals=False)
    assert out["clusters_reaching_generation"] == 0
