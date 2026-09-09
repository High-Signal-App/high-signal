from datetime import datetime, timedelta, timezone

import pytest

from high_signal_ingest import retained_corroboration as retained
from high_signal_ingest.pipeline import _event_entity
from high_signal_ingest.types import Event, SourceDocument

TITLE = "ASML and Intel collaborate on advanced semiconductor lithography production"


@pytest.fixture(autouse=True)
def research_match(monkeypatch):
    monkeypatch.setattr(retained, "match_story", lambda *_: (True, "same_event"))


def announcement(entity="ASML", index=0):
    return Event(
        id=str(index),
        source=f"ir:{entity}",
        source_url=f"https://issuer.example/{index}",
        title=TITLE,
        published_at=datetime.now(timezone.utc),
        primary_entity_id=entity,
        raw_hash=str(index),
        source_document=SourceDocument(parsed_fields={"documentKind": "issuer_announcement"}),
    )


def row(**changes):
    return {
        "url": "https://reporter.example/article",
        "title": TITLE,
        "retainedContent": "Independent source text. " * 40,
        "retainedSource": "news:reporter",
        "seendate": (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat(),
        **changes,
    }


def test_retains_source_date_and_text_without_semantic_credit(monkeypatch):
    original = row()
    monkeypatch.setattr(
        retained.audit, "fetch_related_evidence", lambda title: {"evidence": [original]}
    )
    events, metrics = retained.load_retained_corroboration([announcement()])
    assert len(events) == 1
    assert events[0].source == original["retainedSource"]
    assert events[0].published_at.isoformat() == original["seendate"]
    assert events[0].content == original["retainedContent"]
    assert events[0].source_document.parsed_fields == {"retrievedFrom": "retained_corpus"}
    assert _event_entity(events[0]) in {"ASML", "INTC"}
    assert metrics["related_events_loaded"] == 1


def test_bounds_lookup_count_by_distinct_announcement_url(monkeypatch):
    calls = []
    monkeypatch.setattr(
        retained.audit,
        "fetch_related_evidence",
        lambda title: calls.append(title) or {"evidence": []},
    )
    events = [announcement("ASML", i) for i in range(30)]
    events.append(events[-1].model_copy())
    assert retained.load_retained_corroboration(events)[1]["related_evidence_lookups"] == 24
    assert len(calls) == 24


def test_filters_irrelevant_undated_stale_future_thin_and_duplicate_results(monkeypatch):
    now = datetime.now(timezone.utc)
    rows = [
        row(),
        row(),
        row(title="Unrelated football transfer update"),
        row(seendate="invalid"),
        row(seendate=(now - timedelta(days=5)).isoformat()),
        row(seendate=(now + timedelta(days=1)).isoformat()),
        row(retainedContent="short"),
        row(url="file:///tmp/record"),
    ]
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda title: {"evidence": rows})
    assert len(retained.load_retained_corroboration([announcement()])[0]) == 1


def test_outages_are_not_successful_empty_lookups(monkeypatch):
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda title: None)
    assert (
        retained.load_retained_corroboration([announcement()])[1]["related_evidence_failures"] == 1
    )
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda title: {"evidence": []})
    assert (
        retained.load_retained_corroboration([announcement()])[1]["related_evidence_failures"] == 0
    )


def test_index_snapshots_never_trigger_lookup(monkeypatch):
    event = announcement()
    event.source_document.parsed_fields = {"documentKind": "issuer_index", "discoveryOnly": True}
    monkeypatch.setattr(
        retained.audit,
        "fetch_related_evidence",
        lambda title: (_ for _ in ()).throw(AssertionError("unexpected request")),
    )
    assert retained.load_retained_corroboration([event])[1]["related_evidence_lookups"] == 0


def test_model_budget_and_unavailable_results(monkeypatch):
    rows = [row(url=f"https://reporter.example/{i}") for i in range(10)]
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda _: {"evidence": rows})
    monkeypatch.setattr(retained, "match_story", lambda *_: (False, "model_unavailable"))
    events, metrics = retained.load_retained_corroboration([announcement()])
    assert events == []
    assert metrics["related_story_match_requests"] == 6
    assert metrics["related_story_match_failures"] == 6


def test_matched_different_headlines_reach_story_grouping_without_proof_credit(monkeypatch):
    from high_signal_ingest.pipeline import _pre_group_clusters

    primary = announcement()
    secondary = row(title="Intel production milestone uses ASML lithography tools")
    monkeypatch.setattr(
        retained.audit, "fetch_related_evidence", lambda _: {"evidence": [secondary]}
    )
    events, _ = retained.load_retained_corroboration([primary])
    assert len(events) == 1
    assert events[0].research_story_anchor == primary.source_url
    assert events[0].source_document.parsed_fields == {"retrievedFrom": "retained_corpus"}
    large, batches, skipped = _pre_group_clusters({"ASML": [primary, *events]})
    assert len(large) + sum(len(batch) for batch in batches) == 1
    assert skipped == 0


def test_same_company_but_different_event_stays_out(monkeypatch):
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda _: {"evidence": [row()]})
    monkeypatch.setattr(retained, "match_story", lambda *_: (False, "not_matched"))
    assert retained.load_retained_corroboration([announcement()])[0] == []
