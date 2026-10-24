"""Regression contracts for bounded, independently bound story generation."""

from datetime import datetime, timezone

import pytest

from high_signal_ingest import audit, generator, pipeline
from high_signal_ingest.types import Event


@pytest.fixture
def receipts(monkeypatch):
    rows = []
    monkeypatch.setattr(audit, "push_llm_run", lambda **row: rows.append(row))
    return rows


def event(url, entity="META", *, content="Independent retained reporting.", title=None):
    return Event(
        id=url,
        source="news:test",
        source_url=url,
        published_at=datetime(2026, 10, 23, tzinfo=timezone.utc),
        title=title or f"{entity} material capacity expansion",
        content=content,
        primary_entity_id=entity,
        raw_hash=url,
    )


def item(cluster="story-1", entity="META", urls=()):
    return {
        "cluster_id": cluster,
        "entity_id": entity,
        "publish": True,
        "signal_type": "capacity_change",
        "headline": f"{entity} capacity changed",
        "direction": "up",
        "confidence": "medium",
        "observed_event": f"{entity} expanded capacity.",
        "body_md": f"{entity} expanded capacity. " + " ".join(urls),
        "proofs": [
            {
                "url": url,
                "aligned": True,
                "originating_evidence_id": f"report-{index}",
                "supports": ["observed_event"],
            }
            for index, url in enumerate(urls)
        ],
    }


def respond(monkeypatch, items):
    calls = []

    def complete(prompt, content, **kwargs):
        calls.append((prompt, content, kwargs))
        return {"signals": items}, {"model": "test", "request_user": content[:8000]}

    monkeypatch.setattr(generator, "_ai_complete", complete)
    return calls


def test_actual_kimi_claim_cannot_borrow_proofs_from_meta_sec_cluster(monkeypatch, receipts):
    kimi = "https://www.kimi.ai/blog/kimi-k3-1-pro"
    hn = "https://news.ycombinator.com/item?id=50212065"
    bad = item("story-3", "META", (kimi, hn))
    bad["headline"] = "Moonshot Kimi K3.1 Pro threatens Meta pricing dominance"
    calls = respond(monkeypatch, [bad])
    clusters = [
        ("MOONSHOT", [event(kimi, "MOONSHOT"), event(hn, "MOONSHOT")], []),
        ("AAPL", [event("https://apple.example/report", "AAPL")], []),
        (
            "META",
            [
                event("https://sec.gov/meta-20261019.htm"),
                event("https://sec.gov/meta-20260930.htm"),
            ],
            [],
        ),
    ]
    with pytest.raises(generator.SignalGenerationUnavailable, match="invalid_proof_binding"):
        generator.generate_batch(clusters)
    assert len(calls) == 1
    assert receipts[0]["accepted"] is False
    assert receipts[0]["reason"] == "invalid_proof_binding:1;retained:0"


@pytest.mark.parametrize(
    ("cluster", "entity"),
    [
        ("story-1", "MOONSHOT"),
        ("story-99", "META"),
        ("", "META"),
    ],
)
def test_cluster_and_entity_must_both_match_without_reassignment(
    monkeypatch, receipts, cluster, entity
):
    respond(monkeypatch, [item(cluster, entity)])
    with pytest.raises(generator.SignalGenerationUnavailable, match="invalid_cluster_binding"):
        generator.generate_batch([("META", [event("https://sec.gov/meta.htm")], [])])
    assert receipts[0]["reason"] == "invalid_cluster_binding:1;retained:0"


def test_request_packs_whole_stories_and_audits_omission_without_more_calls(monkeypatch, receipts):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 2600)
    calls = respond(monkeypatch, [])
    clusters = [
        ("META", [event("https://one.example/a", content="A" * 1500)], []),
        ("AAPL", [event("https://two.example/b", "AAPL", content="B" * 1500)], []),
        ("AMD", [event("https://three.example/c", "AMD", content="Complete final paragraph.")], []),
    ]
    assert generator.generate_batch(clusters) == []
    assert len(calls) == 1
    sent = calls[0][1]
    assert len(sent) <= 2600
    assert "A" * 1500 in sent
    assert "B" * 1500 not in sent
    assert "Complete final paragraph." in sent
    assert "=== CLUSTER story-2" not in sent
    assert "=== CLUSTER story-3" in sent
    payload = receipts[0]["request_json"]
    assert payload["user"] == sent
    assert payload["offered_clusters"] == {"story-1": "META", "story-3": "AMD"}
    assert payload["omitted_clusters"] == [
        {"cluster_id": "story-2", "entity_id": "AAPL", "reason": "input_budget"}
    ]
    assert receipts[0]["reason"] == "ok:0/2"


def test_unsent_story_cannot_gain_proofs_but_valid_sibling_keeps_original_gate(
    monkeypatch, receipts
):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 2600)
    good_urls = ("https://primary.example/a", "https://reporter.example/b")
    omitted_urls = ("https://omitted.example/c", "https://other.example/d")
    good = item("story-1", "META", good_urls)
    omitted = item("story-2", "AAPL", omitted_urls)
    calls = respond(monkeypatch, [good, omitted])
    candidates = generator.generate_batch(
        [
            ("META", [event(u, content="P" * 800) for u in good_urls], []),
            ("AAPL", [event(u, "AAPL", content="Q" * 800) for u in omitted_urls], []),
        ]
    )
    assert len(calls) == 1
    assert len(candidates) == 1
    assert candidates[0].source_cluster_id == "story-1"
    assert {e.url for e in candidates[0].evidence} == set(good_urls)
    assert pipeline._proof_verdict(candidates[0]).ok
    assert receipts[0]["accepted"] is False
    assert receipts[0]["reason"] == "invalid_cluster_binding:1;retained:1"


def test_exact_batch_audit_is_not_the_old_eight_thousand_character_preview(monkeypatch, receipts):
    calls = respond(monkeypatch, [])
    clusters = [
        (
            entity,
            [
                event(f"https://{entity.lower()}.example/{i}", entity, content=str(i) * 1500)
                for i in range(2)
            ],
            [],
        )
        for entity in ["META", "AAPL", "AMD"]
    ]
    assert generator.generate_batch(clusters) == []
    sent = calls[0][1]
    assert 8000 < len(sent) <= generator._AI_USER_CONTENT_LIMIT
    assert receipts[0]["request_json"]["user"] == sent
    assert receipts[0]["request_json"]["omitted_clusters"] == []


def test_an_entirely_oversized_batch_is_audited_without_calling_the_provider(monkeypatch, receipts):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 10)
    calls = respond(monkeypatch, [])
    assert generator.generate_batch([("META", [event("https://meta.example/a")], [])]) == []
    assert calls == []
    assert receipts[0]["reason"] == "batch_input_omitted"
    assert receipts[0]["request_json"]["offered_clusters"] == {}
    assert receipts[0]["request_json"]["omitted_clusters"][0]["reason"] == "input_budget"


def test_packing_preserves_all_stories_and_restarts_ids_even_for_one_entity(monkeypatch, receipts):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 2600)
    stories = [
        ("META", [event(f"https://one.example/{n}", content=str(n) * 1500)], []) for n in range(3)
    ]
    batches = generator.pack_generation_batches(stories, max_clusters=12)
    assert [len(batch) for batch in batches] == [1, 1, 1]
    assert [cluster for batch in batches for cluster in batch] == stories
    calls = respond(monkeypatch, [])
    for batch in batches:
        assert generator.generate_batch(batch) == []
    assert len(calls) == 3
    for index, receipt in enumerate(receipts):
        request = receipt["request_json"]
        assert request["offered_clusters"] == {"story-1": "META"}
        assert request["omitted_clusters"] == []
        assert f"https://one.example/{index}" in request["user"]
        assert len(request["user"]) <= 2600


def test_packing_keeps_existing_twelve_cluster_request_cap():
    stories = [("META", [event(f"https://one.example/{n}")], []) for n in range(20)]
    batches = generator.pack_generation_batches(stories, max_clusters=12)
    assert [len(batch) for batch in batches] == [12, 8]
    assert [cluster for batch in batches for cluster in batch] == stories
    assert all(not generator.batch_generation_input(batch).omitted_clusters for batch in batches)


def test_pipeline_pre_group_packs_whole_real_two_origin_stories(monkeypatch):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 2600)
    monkeypatch.setattr(pipeline, "_spillover_candidates", lambda _: [])
    by_entity = {
        entity: [
            event(f"https://primary.example/{entity}", entity, content="A" * 800),
            event(f"https://reporter.example/{entity}", entity, content="B" * 800),
        ]
        for entity in ["META", "AAPL", "AMD"]
    }
    large, batches, skipped = pipeline._pre_group_clusters(by_entity)
    assert large == []
    assert skipped == 0
    assert len(batches) == 3
    assert [entity for batch in batches for entity, _ in batch] == list(by_entity)
    for batch in batches:
        planned = generator.batch_generation_input(
            [(entity, events, []) for entity, events in batch]
        )
        assert len(planned.user) <= 2600
        assert not planned.omitted_clusters
        assert len(planned.cluster_entities) == len(batch)


def test_oversized_singleton_does_not_hide_later_story(monkeypatch):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 1000)
    oversized = ("META", [event("https://big.example/a", content="X" * 1500)], [])
    normal = ("AAPL", [event("https://small.example/b", "AAPL")], [])
    batches = generator.pack_generation_batches([oversized, normal], max_clusters=12)
    assert batches == [[oversized], [normal]]
    assert generator.batch_generation_input(batches[0]).omitted_clusters
    assert generator.batch_generation_input(batches[1]).cluster_entities == {"story-1": "AAPL"}


def test_run_counts_actual_provider_calls_and_oversized_cluster_omission(monkeypatch, receipts):
    monkeypatch.setattr(generator, "_AI_USER_CONTENT_LIMIT", 10)
    source_event = event("https://meta.example/a")
    monkeypatch.setattr(pipeline, "fetch", lambda *_a, **_k: [source_event])
    monkeypatch.setattr(audit, "push_events", lambda events, _run: len(events))
    monkeypatch.setattr(audit, "push_ingest_runs", lambda *_a, **_k: None)
    runs = []
    monkeypatch.setattr(audit, "push_ingest_run", lambda **row: runs.append(row))
    monkeypatch.setattr(pipeline, "load_retained_corroboration", lambda _: ([], {}))
    monkeypatch.setattr(
        pipeline, "_pre_group_clusters", lambda _: ([], [[("META", [source_event])]], 0)
    )
    monkeypatch.setattr(pipeline, "_spillover_candidates", lambda _: [])
    monkeypatch.setattr(pipeline, "_fallback_drafts_enabled", lambda: False)
    monkeypatch.setattr(pipeline, "_emit_thematic_drafts", lambda *_a, **_k: [])
    calls = respond(monkeypatch, [])
    result = pipeline.run("news", 1)
    assert calls == []
    assert result["generation_requests"] == 0
    assert result["clusters_reaching_generation"] == 0
    assert result["clusters_omitted_input_budget"] == 1
    assert result["signals_drafted"] == 0
    assert "clusters_omitted_input_budget=1" in runs[0]["notes"]
    assert receipts[0]["reason"] == "batch_input_omitted"
