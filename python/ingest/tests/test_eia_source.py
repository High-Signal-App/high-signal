from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import eia


def test_events_from_response_parses_price() -> None:
    payload = {
        "response": {
            "data": [
                {"period": "2026-04", "stateid": "VA", "price": 7.42, "price-units": "cents per kilowatthour"}
            ]
        }
    }
    events = eia.events_from_response(payload, datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "eia"
    assert "VA" in ev.title and "7.42" in ev.title


def test_fetch_all_skips_without_api_key(monkeypatch) -> None:
    monkeypatch.delenv("EIA_API_KEY", raising=False)
    assert eia.fetch_all(api_key=None) == []


def test_pipeline_fetch_includes_eia(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.eia, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("eia", days=1) == []
    assert calls == [120]
