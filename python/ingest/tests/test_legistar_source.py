from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import legistar


def _matter(**over) -> dict:
    base = {
        "MatterId": 123,
        "MatterGuid": "ABCD-EF",
        "MatterFile": "26-100",
        "MatterTitle": "Conditional Use Permit for a data center at 1 Main St.",
        "MatterName": None,
        "MatterTypeName": "Ordinance",
        "MatterStatusName": "Agenda Ready",
        "MatterBodyName": "City Council",
        "MatterIntroDate": "2026-06-10T00:00:00",
        "MatterAgendaDate": "2026-07-01T00:00:00",
    }
    base.update(over)
    return base


def test_events_from_matters_keeps_relevant_development_item() -> None:
    events = legistar.events_from_matters(
        "phoenix",
        "Phoenix AZ",
        [_matter()],
        datetime(2026, 5, 1, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    ev = events[0]
    assert ev.source == "legistar:phoenix"
    assert ev.source_url == "https://phoenix.legistar.com/LegislationDetail.aspx?ID=123&GUID=ABCD-EF"
    assert "Phoenix AZ — City Council" in ev.title
    assert "data center" in (ev.content or "").lower()


def test_events_from_matters_drops_procedural_and_irrelevant() -> None:
    matters = [
        # procedural minutes (matches "zoning" but is noise)
        _matter(MatterId=1, MatterTypeName="Minutes", MatterTitle="Planning and Zoning minutes"),
        # no relevant keyword at all
        _matter(MatterId=2, MatterTypeName="Ordinance", MatterTitle="Proclaiming Library Week"),
    ]
    events = legistar.events_from_matters(
        "mesa", "Mesa AZ", matters, datetime(2026, 5, 1, tzinfo=timezone.utc)
    )
    assert events == []


def test_land_use_consent_agenda_rezoning_is_kept() -> None:
    # San Jose types its land-use items as "...Consent Agenda" — must not be
    # treated as procedural noise.
    matter = _matter(
        MatterTypeName="Land Use Consent Agenda",
        MatterTitle="C26-005 - Rezoning Certain Real Property Located at 1402 Monterey Road.",
    )
    events = legistar.events_from_matters(
        "sanjose", "San Jose CA", [matter], datetime(2026, 5, 1, tzinfo=timezone.utc)
    )
    assert len(events) == 1


def test_events_from_matters_honours_since_window() -> None:
    old = _matter(MatterIntroDate="2026-01-01T00:00:00", MatterAgendaDate=None)
    events = legistar.events_from_matters(
        "sanjose", "San Jose CA", [old], datetime(2026, 6, 1, tzinfo=timezone.utc)
    )
    assert events == []


def test_clients_from_env_override(monkeypatch) -> None:
    monkeypatch.setenv("LEGISTAR_CLIENTS", "foo:Foo City, bar")
    assert legistar._clients_from_env() == [("foo", "Foo City"), ("bar", "bar")]


def test_pipeline_fetch_includes_legistar(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.legistar, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("legistar", days=1) == []
    assert calls == [30]
