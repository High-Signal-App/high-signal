from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import bls


def test_events_from_response_latest_print() -> None:
    payload = {
        "Results": {
            "series": [
                {
                    "seriesID": "LNS14000000",
                    "data": [
                        {"year": "2026", "period": "M05", "periodName": "May", "value": "4.3"},
                        {"year": "2026", "period": "M04", "periodName": "April", "value": "4.2"},
                    ],
                }
            ]
        }
    }
    events = bls.events_from_response(payload, datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "bls"
    assert "Unemployment rate: 4.3" in ev.title
    assert ev.published_at.month == 5  # latest (newest-first) is used


def test_events_from_response_honours_window() -> None:
    payload = {"Results": {"series": [{"seriesID": "LNS14000000", "data": [{"year": "2020", "period": "M01", "periodName": "January", "value": "3.5"}]}]}}
    assert bls.events_from_response(payload, datetime(2026, 1, 1, tzinfo=timezone.utc)) == []


def test_pipeline_fetch_includes_bls(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.bls, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("bls", days=1) == []
    assert calls == [120]
