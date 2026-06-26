from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import coingecko

_NOW = datetime(2026, 6, 26, tzinfo=timezone.utc)


def test_trending_events() -> None:
    payload = {"coins": [{"item": {"id": "aave", "name": "Aave", "symbol": "aave", "market_cap_rank": 51}}]}
    events = coingecko.trending_events(payload, _NOW)
    assert len(events) == 1
    assert events[0].source == "coingecko"
    assert "Aave (AAVE)" in events[0].title


def test_mover_events_filters_threshold() -> None:
    rows = [
        {"id": "x", "name": "BigMove", "symbol": "bm", "price_change_percentage_24h": 22.5, "current_price": 1, "market_cap": 9},
        {"id": "y", "name": "Flat", "symbol": "fl", "price_change_percentage_24h": 2.0},
    ]
    events = coingecko.mover_events(rows, _NOW)
    assert len(events) == 1  # only the >15% mover
    assert "+22.5% 24h" in events[0].title


def test_pipeline_fetch_includes_coingecko(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.coingecko, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("coingecko", days=1) == []
    assert calls == [1]
