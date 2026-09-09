from datetime import datetime, timezone
import json
import re
from pathlib import Path

from high_signal_ingest.thematic import buildout_stories
from high_signal_ingest.types import Event


def event(title: str, source: str = "news", index: int = 0) -> Event:
    return Event(
        id=str(index),
        source=source,
        source_url=f"https://{source}.example/{index}",
        title=title,
        content=title,
        published_at=datetime(2026, 9, 9, tzinfo=timezone.utc),
        raw_hash=str(index),
    )


def test_same_project_paraphrases_group_without_identical_title_words():
    events = [
        event("Council approves Orion data center campus in Mesa", "legistar", 1),
        event("Orion data centre in Mesa wins approval for 200MW expansion", "news", 2),
    ]
    assert buildout_stories(events) == [events]


def test_unrelated_live_draft_topics_are_not_buildout_corroboration():
    events = [
        event(title, index=i)
        for i, title in enumerate(
            [
                "Imec Advances Scalable Superconducting Tech with NbTiN Circuits and 30nm Interconnects",
                "Qatar's Meeza signs 8MW lease with global hyperscaler",
                "Ann Arbor City Council: Office District rezoning approved",
                "Mesa retail development tax incentive agreement approved",
                "Denver map amendment to rezone property on Federal Blvd",
            ]
        )
    ]
    assert buildout_stories(events) == []


def test_conflicting_operator_location_site_and_action_do_not_merge():
    titles = [
        "Council approves Orion data center site 1 in Mesa",
        "Council approves Vega data center site 1 in Mesa",
        "Council approves Orion data center site 1 in Denver",
        "Council approves Orion data center site 2 in Mesa",
        "Orion data center site 1 in Mesa signs lease",
    ]
    groups = buildout_stories([event(title, index=i) for i, title in enumerate(titles)])
    assert all(len(group) == 1 for group in groups)
    assert len(groups) == len(titles)


def test_unknown_site_cannot_bridge_conflicting_numbered_sites():
    titles = [
        "Council approves Orion data center site 1 in Mesa",
        "Council approves Orion data center in Mesa",
        "Council approves Orion data center site 2 in Mesa",
    ]
    groups = buildout_stories([event(title, index=i) for i, title in enumerate(titles)])
    assert max(map(len, groups)) == 2


def test_generic_or_unlocated_project_is_not_a_named_event():
    assert (
        buildout_stories(
            [
                event("New data center approved in Mesa"),
                event("Orion data center approved"),
                event("Orion data center in Mesa develops new chips"),
            ]
        )
        == []
    )


def test_retained_production_draft_citations_do_not_form_one_story():
    receipt = json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "docs/operations/2026-09-09-thematic-draft-readback.json"
        ).read_text()
    )
    titles = re.findall(r"^- \[(.*?)\]\(https?://.*?\)$", receipt["signal"]["bodyMd"], re.M)
    assert len(titles) == 6
    assert buildout_stories([event(title, index=i) for i, title in enumerate(titles)]) == []
