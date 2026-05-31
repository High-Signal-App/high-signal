from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import lobsters


def test_events_from_feed_maps_lobsters_rss_item() -> None:
    xml = """<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>NixOS 26.05 released</title>
          <link>https://lobste.rs/s/pudkct/nixos_26_05_released</link>
          <pubDate>Sat, 30 May 2026 14:47:40 +0000</pubDate>
          <description>Technical release discussion.</description>
          <category>release</category>
        </item>
      </channel>
    </rss>
    """

    events = lobsters.events_from_feed(xml, datetime(2026, 5, 30, tzinfo=timezone.utc))

    assert len(events) == 1
    assert events[0].source == "lobsters"
    assert events[0].title == "NixOS 26.05 released"
    assert events[0].source_url == "https://lobste.rs/s/pudkct/nixos_26_05_released"


def test_events_from_feed_filters_off_topic_items() -> None:
    xml = """<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>I Am Retiring from Tech to Live Offline</title>
          <link>https://lobste.rs/s/offline</link>
          <pubDate>Sat, 30 May 2026 14:47:40 +0000</pubDate>
          <description>Personal essay.</description>
          <category>culture</category>
        </item>
      </channel>
    </rss>
    """

    events = lobsters.events_from_feed(xml, datetime(2026, 5, 30, tzinfo=timezone.utc))

    assert events == []


def test_pipeline_fetch_includes_lobsters(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.lobsters, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("lobsters", days=1) == []
    assert calls == [3]
