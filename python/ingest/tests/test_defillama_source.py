from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import defillama

_NOW = datetime(2026, 6, 27, tzinfo=timezone.utc)


def test_events_filter_tvl_and_move() -> None:
    rows = [
        {"name": "BigMover", "slug": "big", "category": "Lending", "tvl": 2.0e9, "change_1d": 18.0},
        {"name": "TooSmall", "slug": "small", "category": "DEX", "tvl": 5.0e7, "change_1d": 40.0},   # tvl < $100M
        {"name": "Flat", "slug": "flat", "category": "DEX", "tvl": 5.0e9, "change_1d": 1.0},          # move < 10%
    ]
    events = defillama.events_from_protocols(rows, _NOW)
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "defillama"
    assert "BigMover" in ev.title and "+18.0% 1d" in ev.title
    assert ev.source_url == "https://defillama.com/protocol/big"


def test_pipeline_fetch_includes_defillama(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.defillama, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("defillama", days=1) == []
    assert calls == [1]
