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


@pytest.mark.parametrize(
    "entity,primary_title,secondary_title",
    [
        (
            "AMAT",
            "Applied Materials to Report Fourth Quarter and Fiscal 2026 Results",
            "Rockwell Automation to Report Fourth Quarter and Full Year Fiscal 2026 Results",
        ),
        (
            "WDC",
            "WD Reports Fiscal First Quarter 2027 Financial Results",
            "Fabrinet to Announce First Quarter Fiscal 2027 Financial Results",
        ),
        (
            "WDC",
            "WD Reports Fiscal First Quarter 2027 Financial Results",
            "Rockwell Automation to Report Fourth Quarter and Full Year Fiscal 2026 Results",
        ),
        (
            "AMAT",
            "Applied Materials to Report Fourth Quarter and Fiscal 2026 Results",
            "Fabrinet to Announce First Quarter Fiscal 2027 Financial Results",
        ),
        (
            "AMAT",
            "Applied Materials to Report Fourth Quarter and Fiscal 2026 Results",
            "TI reports third quarter 2026 financial results and shareholder returns | Texas Instruments",
        ),
        (
            "ACLS",
            "Axcelis Announces Timing and Availability of Third Quarter 2026 Results and Conference Call | Axcelis Technologies Inc",
            "ACM Research to Release Third Quarter 2026 Financial Results",
        ),
    ],
)
def test_actual_unrelated_issuer_pairs_never_spend_model_budget(
    monkeypatch, entity, primary_title, secondary_title
):
    primary = announcement(entity)
    primary.title = primary_title
    secondary = row(title=secondary_title)
    candidate = retained._retained_event(secondary, primary_title, datetime.now(timezone.utc))
    assert candidate is not None
    assert not retained._issuer_compatible(primary, candidate)
    monkeypatch.setattr(
        retained.audit, "fetch_related_evidence", lambda _: {"evidence": [secondary]}
    )
    monkeypatch.setattr(
        retained,
        "match_story",
        lambda *_: (_ for _ in ()).throw(AssertionError("unrelated issuer")),
    )
    events, metrics = retained.load_retained_corroboration([primary])
    assert events == []
    assert metrics["related_story_match_requests"] == 0


@pytest.mark.parametrize(
    "title",
    [
        "Applied Materials to Report Fourth Quarter and Fiscal 2026 Results on Nov. 12, 2026",
        "Rockwell Automation to Report Fourth Quarter and Full Year Fiscal 2026 Results and Introduce Fiscal 2027 Guidance",
        "Centrus to Webcast Conference Call on November 5 at 8:30 a.m. ET",
        "Axcelis Announces Timing and Availability of Third Quarter 2026 Results and Conference Call | Axcelis Technologies Inc",
    ],
)
def test_routine_earnings_notices_are_not_research_seeds(monkeypatch, title):
    primary = announcement()
    primary.title = title
    monkeypatch.setattr(
        retained.audit,
        "fetch_related_evidence",
        lambda _: (_ for _ in ()).throw(AssertionError("notice lookup")),
    )
    events, metrics = retained.load_retained_corroboration([primary])
    assert events == []
    assert metrics["related_evidence_lookups"] == 0
    assert metrics["related_seed_notices_skipped"] == 1


@pytest.mark.parametrize(
    "title",
    [
        "ASML to announce annual capacity expansion at its new manufacturing facility",
        "ASML to announce annual supply contract with Intel for advanced lithography tools",
    ],
)
def test_material_annual_announcements_remain_research_seeds(monkeypatch, title):
    primary = announcement()
    primary.title = title
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda _: {"evidence": []})
    _, metrics = retained.load_retained_corroboration([primary])
    assert metrics["related_evidence_lookups"] == 1
    assert metrics["related_seed_notices_skipped"] == 0


def test_actual_results_remain_research_seeds(monkeypatch):
    primary = announcement("WDC")
    primary.title = (
        "WD Reports Fiscal First Quarter 2027 Financial Results | Western Digital Corporation"
    )
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda _: {"evidence": []})
    _, metrics = retained.load_retained_corroboration([primary])
    assert metrics["related_evidence_lookups"] == 1
    assert metrics["related_seed_notices_skipped"] == 0


def test_same_batch_report_receives_anchor_without_duplicate_or_receipt_rewrite(monkeypatch):
    from high_signal_ingest.dedupe import dedupe_exact
    from high_signal_ingest.pipeline import _pre_group_clusters

    primary = announcement()
    secondary = row(title="Intel production milestone uses ASML lithography tools")
    fetched = retained._retained_event(secondary, primary.title, datetime.now(timezone.utc))
    assert fetched is not None
    fetched.primary_entity_id = "INTC"
    document = fetched.source_document
    original_content = fetched.content
    duplicate = fetched.model_copy(update={"source": "gdelt:duplicate", "id": "duplicate"})
    representatives = dedupe_exact([primary, fetched, duplicate])
    assert fetched in representatives and duplicate not in representatives
    monkeypatch.setattr(
        retained.audit, "fetch_related_evidence", lambda _: {"evidence": [secondary]}
    )
    related, metrics = retained.load_retained_corroboration(representatives)
    assert related == []
    assert metrics["related_existing_events_associated"] == 1
    assert metrics["related_events_loaded"] == 0
    assert fetched.research_story_anchor == primary.source_url
    assert _event_entity(fetched) == "ASML"
    assert fetched.source_document is document
    assert fetched.content == original_content
    large, batches, skipped = _pre_group_clusters({"ASML": representatives})
    assert len(large) + sum(len(batch) for batch in batches) == 1
    assert skipped == 0


def test_rejected_duplicate_pair_uses_one_slot_and_keeps_fullest_body(monkeypatch):
    noise = row(
        url="https://reporter.example/wrong", retainedContent="ASML earlier-event report. " * 25
    )
    fuller = {
        **noise,
        "url": noise["url"] + "?utm_source=other",
        "retainedContent": "ASML earlier-event detail. " * 60,
    }
    good = row(
        url="https://independent.example/current",
        title="Intel production milestone uses ASML lithography tools",
    )
    monkeypatch.setattr(
        retained.audit,
        "fetch_related_evidence",
        lambda _: {"evidence": [noise] * 5 + [fuller, good]},
    )
    calls = []

    def match(_primary, candidate):
        calls.append(candidate)
        accepted = "independent.example" in candidate.source_url
        return accepted, "same_event" if accepted else "not_matched"

    monkeypatch.setattr(retained, "match_story", match)
    events, metrics = retained.load_retained_corroboration([announcement()])
    assert len(calls) == 2
    assert calls[0].content == fuller["retainedContent"]
    assert [event.source_url for event in events] == [good["url"]]
    assert metrics["related_candidate_pairs_deduplicated"] == 5
    assert metrics["related_story_match_failures"] == 0


def test_issuer_in_distant_boilerplate_is_not_a_research_candidate(monkeypatch):
    secondary = row(
        title="Intel production milestone uses advanced lithography tools",
        retainedContent="Intel production results. " * 50 + " ASML related article.",
    )
    monkeypatch.setattr(
        retained.audit, "fetch_related_evidence", lambda _: {"evidence": [secondary]}
    )
    events, metrics = retained.load_retained_corroboration([announcement()])
    assert events == []
    assert metrics["related_candidates_rejected_entity"] == 1
    assert metrics["related_story_match_requests"] == 0


@pytest.mark.parametrize(
    "reason", ["invalid_response", "invalid_event_description", "invalid_passage_selection"]
)
def test_malformed_matching_counts_as_operational_failure(monkeypatch, reason):
    monkeypatch.setattr(retained.audit, "fetch_related_evidence", lambda _: {"evidence": [row()]})
    monkeypatch.setattr(retained, "match_story", lambda *_: (False, reason))
    events, metrics = retained.load_retained_corroboration([announcement()])
    assert events == []
    assert metrics["related_story_match_requests"] == 1
    assert metrics["related_story_match_failures"] == 1
