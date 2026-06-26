from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import google_trends

_FEED = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>ai notetaker app</title>
    <pubDate>Thu, 25 Jun 2026 10:00:00 +0000</pubDate>
  </item>
</channel></rss>"""


def test_events_from_feed_parses_trend() -> None:
    events = google_trends.events_from_feed("US", _FEED, datetime(2026, 6, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "google-trends:us"
    assert "Trending search (US): ai notetaker app" == ev.title


def test_pipeline_fetch_includes_google_trends(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.google_trends, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("google-trends", days=1) == []
    assert calls == [2]
