from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import producthunt

_FEED = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Product Hunt</title>
  <item>
    <title>Acme AI Notetaker</title>
    <link>https://www.producthunt.com/products/acme-ai</link>
    <pubDate>Thu, 25 Jun 2026 22:37:09 +0000</pubDate>
    <description>The fastest AI notetaker</description>
  </item>
</channel></rss>"""


def test_events_from_feed_parses_launch() -> None:
    events = producthunt.events_from_feed(_FEED, datetime(2026, 6, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "producthunt"
    assert ev.title == "Product Hunt launch: Acme AI Notetaker"
    assert ev.source_url == "https://www.producthunt.com/products/acme-ai"


def test_events_from_feed_honours_window() -> None:
    assert producthunt.events_from_feed(_FEED, datetime(2026, 7, 1, tzinfo=timezone.utc)) == []


def test_pipeline_fetch_includes_producthunt(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.producthunt, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("producthunt", days=1) == []
    assert calls == [7]
