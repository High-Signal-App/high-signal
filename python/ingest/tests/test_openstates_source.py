from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import openstates
from high_signal_ingest.sources.openstates import StateQuery


def test_events_from_response_parses_bill() -> None:
    payload = {
        "results": [
            {
                "identifier": "HB 1234",
                "title": "Data center sales tax exemption and siting standards",
                "jurisdiction": {"name": "Virginia"},
                "latest_action_date": "2026-06-12",
                "latest_action_description": "Passed House",
                "openstates_url": "https://openstates.org/va/bills/2026/HB1234/",
            }
        ]
    }
    events = openstates.events_from_response(
        StateQuery("Virginia", "data center"), payload, datetime(2026, 5, 1, tzinfo=timezone.utc)
    )
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "openstates"
    assert ev.source_url == "https://openstates.org/va/bills/2026/HB1234/"
    assert "Virginia bill HB 1234" in ev.title


def test_fetch_all_skips_without_api_key(monkeypatch) -> None:
    monkeypatch.delenv("OPENSTATES_API_KEY", raising=False)
    assert openstates.fetch_all(api_key=None) == []


def test_pipeline_fetch_includes_openstates(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.openstates, "fetch_all", fake_fetch_all)
    assert pipeline.fetch("openstates", days=1) == []
    assert calls == [30]
