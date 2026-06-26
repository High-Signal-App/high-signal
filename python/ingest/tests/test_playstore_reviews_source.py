from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import playstore_reviews


def test_reviews_to_events_parses() -> None:
    rows = [
        {
            "reviewId": "abc",
            "content": "Keeps logging me out",
            "score": 2,
            "at": datetime(2026, 6, 25, tzinfo=timezone.utc),
            "_appId": "com.openai.chatgpt",
        }
    ]
    events = playstore_reviews.reviews_to_events("ChatGPT", rows, datetime(2026, 6, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "playstore-reviews"
    assert "ChatGPT (2★): Keeps logging me out" in ev.title
    assert "com.openai.chatgpt" in ev.source_url


def test_reviews_to_events_honours_window() -> None:
    rows = [{"reviewId": "x", "content": "old", "score": 5, "at": datetime(2020, 1, 1, tzinfo=timezone.utc)}]
    assert playstore_reviews.reviews_to_events("X", rows, datetime(2026, 6, 1, tzinfo=timezone.utc)) == []


def test_apps_from_env_override(monkeypatch) -> None:
    monkeypatch.setenv("PLAYSTORE_REVIEW_APPS", "Acme:com.acme.app, Bad")
    assert playstore_reviews._apps_from_env() == [("Acme", "com.acme.app")]


def test_pipeline_fetch_includes_playstore_reviews(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.playstore_reviews, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("playstore-reviews", days=1) == []
    assert calls == [14]
