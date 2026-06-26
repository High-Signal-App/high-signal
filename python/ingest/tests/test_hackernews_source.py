from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import hackernews


def test_events_from_response_parses_story() -> None:
    payload = {
        "hits": [
            {
                "objectID": "123",
                "title": "OpenAI releases new model",
                "created_at_i": int(datetime(2026, 6, 20, tzinfo=timezone.utc).timestamp()),
                "points": 250,
                "num_comments": 80,
                "url": "https://example.com/post",
                "author": "pg",
            }
        ]
    }
    events = hackernews.events_from_response(payload, datetime(2026, 6, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "hackernews"
    assert ev.source_url == "https://news.ycombinator.com/item?id=123"
    assert ev.title == "HN: OpenAI releases new model"
    assert "Points: 250" in (ev.content or "")


def test_events_from_response_honours_since_window() -> None:
    payload = {"hits": [{"objectID": "1", "title": "old", "created_at_i": 100}]}
    assert hackernews.events_from_response(payload, datetime(2026, 6, 1, tzinfo=timezone.utc)) == []


def test_pipeline_fetch_includes_hackernews(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.hackernews, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("hackernews", days=1) == []
    assert calls == [7]
