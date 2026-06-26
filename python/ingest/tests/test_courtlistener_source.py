from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import courtlistener


def test_events_from_response_parses_opinion() -> None:
    payload = {
        "results": [
            {
                "caseName": "Brandt v. nVidia Corp",
                "dateFiled": "2026-06-10",
                "court": "Court of Appeals for the Ninth Circuit",
                "absolute_url": "/opinion/123/brandt-v-nvidia/",
                "docketNumber": "24-1234",
                "suitNature": "Antitrust",
            }
        ]
    }
    events = courtlistener.events_from_response(
        "semiconductor antitrust", payload, datetime(2026, 5, 1, tzinfo=timezone.utc)
    )
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "courtlistener"
    assert ev.source_url == "https://www.courtlistener.com/opinion/123/brandt-v-nvidia/"
    assert "nVidia" in ev.title
    assert "Antitrust" in (ev.content or "")


def test_events_from_response_honours_since_window() -> None:
    payload = {"results": [{"caseName": "Old v. Case", "dateFiled": "2026-01-01", "absolute_url": "/x/"}]}
    events = courtlistener.events_from_response(
        "q", payload, datetime(2026, 6, 1, tzinfo=timezone.utc)
    )
    assert events == []


def test_pipeline_fetch_includes_courtlistener(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.courtlistener, "fetch_all", fake_fetch_all)
    assert pipeline.fetch("courtlistener", days=1) == []
    assert calls == [30]
