from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import appstore_reviews


def _payload(updated: str) -> dict:
    return {
        "feed": {
            "entry": [
                {"im:name": {"label": "ChatGPT"}},  # app metadata entry (no im:rating)
                {
                    "im:rating": {"label": "1"},
                    "title": {"label": "Crashes constantly"},
                    "content": {"label": "App crashes on launch every time"},
                    "id": {"label": "999"},
                    "updated": {"label": updated},
                    "link": {"attributes": {"href": "https://apps.apple.com/r/999"}},
                },
            ]
        }
    }


def test_reviews_from_feed_skips_metadata_and_parses() -> None:
    events = appstore_reviews.reviews_from_feed(
        "ChatGPT", _payload("2026-06-25T08:00:00-07:00"), datetime(2026, 6, 1, tzinfo=timezone.utc)
    )
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "appstore-reviews"
    assert "ChatGPT (1★): Crashes constantly" in ev.title
    assert ev.source_url == "https://apps.apple.com/r/999"


def test_reviews_from_feed_honours_window() -> None:
    assert appstore_reviews.reviews_from_feed(
        "ChatGPT", _payload("2020-01-01T00:00:00-07:00"), datetime(2026, 6, 1, tzinfo=timezone.utc)
    ) == []


def test_pipeline_fetch_includes_appstore_reviews(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.appstore_reviews, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("appstore-reviews", days=1) == []
    assert calls == [14]
