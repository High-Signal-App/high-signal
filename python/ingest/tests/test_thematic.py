from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest.extract.entities import gazetteer_match
from high_signal_ingest.generator import thematic_candidate
from high_signal_ingest.quality import assess_signal_quality
from high_signal_ingest.seed import load_entities
from high_signal_ingest.types import Event


def _ev(source: str, title: str, url: str) -> Event:
    return Event(
        id=title[:16],
        source=source,
        source_url=url,
        published_at=datetime(2026, 6, 20, tzinfo=timezone.utc),
        title=title,
        content="rezoning for a hyperscale data center campus and substation",
        primary_entity_id=None,
        raw_hash=title,
    )


def test_theme_entity_seeded_but_not_matchable() -> None:
    assert "THEME_DATACENTER" in {e.id for e in load_entities()}
    # Synthetic bucket — never detected from text.
    assert "THEME_DATACENTER" not in gazetteer_match("data center buildout in the county")


def test_thematic_candidate_requires_two_urls() -> None:
    one = thematic_candidate(
        "THEME_DATACENTER", "data_center_buildout", [_ev("legistar", "x", "https://l/1")]
    )
    assert one is None


def test_thematic_candidate_builds_publishable_draft() -> None:
    cand = thematic_candidate(
        "THEME_DATACENTER",
        "data_center_buildout",
        [
            _ev("legistar:loudoun", "Data center rezoning approved", "https://l/1"),
            _ev("courtlistener", "Data center siting appeal", "https://c/2"),
        ],
    )
    assert cand is not None
    assert cand.signal_type == "data_center_buildout"
    assert cand.primary_entity_id == "THEME_DATACENTER"
    assert len(cand.evidence) == 2
    # Must NOT carry the fallback marker that the quality gate auto-kills.
    assert "fallback draft generated" not in cand.body_md.lower()
    assert assess_signal_quality(cand).publishable is True
