from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import appstore

_NOW = datetime(2026, 6, 27, tzinfo=timezone.utc)


def test_events_from_chart_ranks() -> None:
    payload = {
        "feed": {
            "results": [
                {"id": "1", "name": "Kalshi", "artistName": "KalshiEX", "url": "https://x/1", "genres": [{"name": "Finance"}]},
                {"id": "2", "name": "ChatGPT", "artistName": "OpenAI", "url": "https://x/2", "genres": [{"name": "Productivity"}]},
            ]
        }
    }
    events = appstore.events_from_chart("top-free", "Top Free", payload, _NOW)
    assert len(events) == 2
    assert events[0].source == "appstore:top-free"
    assert "Top Free #1: Kalshi" in events[0].title
    assert "Top Free #2: ChatGPT" in events[1].title


def test_pipeline_fetch_includes_appstore(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.appstore, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("appstore", days=1) == []
    assert calls == [1]
