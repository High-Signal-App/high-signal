from datetime import datetime, timedelta, timezone

from high_signal_ingest import retained_corroboration as retained
from high_signal_ingest.pipeline import _event_entity
from high_signal_ingest.types import Event, SourceDocument

TITLE = "ASML and Intel collaborate on advanced semiconductor lithography production"


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


def test_bounds_lookup_count_and_avoids_repeating_entity(monkeypatch):
    calls = []
    monkeypatch.setattr(
        retained.audit,
        "fetch_related_evidence",
        lambda title: calls.append(title) or {"evidence": []},
    )
    events = [announcement(f"ENTITY{i}", i) for i in range(10)]
    events.append(announcement("ENTITY9", 11))
    assert retained.load_retained_corroboration(events)[1]["related_evidence_lookups"] == 6
    assert len(calls) == 6


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
