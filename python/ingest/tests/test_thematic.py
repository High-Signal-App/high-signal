from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.extract.entities import gazetteer_match
from high_signal_ingest.seed import load_entities
from high_signal_ingest.types import Event, EvidenceItem, SignalCandidate


def _ev(source, index, title="Council approves Orion data center in Mesa"):
    return Event(
        id=str(index),
        source=source,
        source_url=f"https://{source}.example/{index}",
        published_at=datetime(2026, 9, 9, tzinfo=timezone.utc),
        title=title,
        content=title,
        raw_hash=str(index),
    )


def _candidate(events, verified=True):
    return SignalCandidate(
        slug="orion",
        signal_type="data_center_buildout",
        primary_entity_id="THEME_DATACENTER",
        direction="neutral",
        confidence="low",
        predicted_window_days=30,
        published_at=events[0].published_at,
        body_md="Reviewed event",
        evidence=[
            EvidenceItem(
                url=e.source_url,
                source_type=e.source,
                semantic_alignment="verified" if verified else "unverified",
                originating_evidence_id=e.source_url,
                role="primary" if i == 0 else "corroboration",
            )
            for i, e in enumerate(events)
        ],
    )


def test_theme_entity_seeded_but_not_matchable():
    assert "THEME_DATACENTER" in {e.id for e in load_entities()}
    assert "THEME_DATACENTER" not in gazetteer_match("data center buildout in the county")


def test_coherent_story_uses_semantic_generator_and_normal_proof_gate(monkeypatch):
    events = [
        _ev("legistar", 1),
        _ev("news", 2, "Orion data centre in Mesa wins approval for 200MW expansion"),
    ]
    calls = []

    def generate(entity, selected, spillover):
        calls.append((entity, selected, spillover))
        return _candidate(selected)

    monkeypatch.setattr(pipeline, "generate", generate)
    monkeypatch.setattr(pipeline, "emit", lambda candidate: candidate.slug)
    assert pipeline._emit_thematic_drafts(events) == ["orion"]
    assert calls == [("THEME_DATACENTER", events, [])]
    monkeypatch.setattr(pipeline, "generate", lambda *_: _candidate(events, verified=False))
    assert pipeline._emit_thematic_drafts(events) == []


def test_bad_live_topics_do_not_reach_generation(monkeypatch):
    events = [
        _ev("legistar", 1, "Mesa retail development tax incentive agreement approved"),
        _ev("news", 2, "Imec advances superconducting technology for hyperscalers"),
    ]

    def unexpected(*args):
        raise AssertionError("Unrelated topics reached generation")

    monkeypatch.setattr(pipeline, "generate", unexpected)
    assert pipeline._emit_thematic_drafts(events) == []


def test_citation_selection_is_bounded_and_unique(monkeypatch):
    events = [_ev("legistar" if i == 0 else "news", i) for i in range(9)]
    seen = []

    def generate(entity, selected, spillover):
        seen.extend(selected)
        return _candidate(selected)

    monkeypatch.setattr(pipeline, "generate", generate)
    monkeypatch.setattr(pipeline, "emit", lambda candidate: candidate.slug)
    assert pipeline._emit_thematic_drafts(events + events) == ["orion"]
    assert len(seen) == len({e.source_url for e in seen}) == 6


def test_rejected_generation_attempts_remain_bounded(monkeypatch):
    events = []
    for i in range(8):
        title = f"Council approves Orion data center site {i} in Mesa"
        events.extend([_ev("legistar", i, title), _ev("news", i, title)])
    calls = []
    monkeypatch.setattr(pipeline, "generate", lambda *args: calls.append(args))
    assert pipeline._emit_thematic_drafts(events) == []
    assert len(calls) == pipeline._THEMATIC_DRAFT_LIMIT
