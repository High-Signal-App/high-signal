from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import techmeme


def test_events_from_feed_uses_original_article_url() -> None:
    xml = """<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Sources: Microsoft and Nvidia will unveil Windows PCs (Axios)</title>
          <link>https://www.techmeme.com/260531/p4#a260531p4</link>
          <description><![CDATA[
            <p><a href="https://www.axios.com/2026/05/30/nvidia-microsoft-pcs-ai-surface-dell">Axios story</a></p>
          ]]></description>
          <pubDate>Sun, 31 May 2026 01:35:00 -0400</pubDate>
        </item>
      </channel>
    </rss>
    """

    events = techmeme.events_from_feed(xml, datetime(2026, 5, 31, tzinfo=timezone.utc))

    assert len(events) == 1
    assert events[0].source == "techmeme"
    assert events[0].source_url == "https://www.axios.com/2026/05/30/nvidia-microsoft-pcs-ai-surface-dell"
    assert "Techmeme permalink" in (events[0].content or "")


def test_events_from_feed_filters_old_items() -> None:
    xml = """<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Old item</title>
          <link>https://www.techmeme.com/old</link>
          <pubDate>Sun, 31 May 2026 01:35:00 -0400</pubDate>
        </item>
      </channel>
    </rss>
    """

    events = techmeme.events_from_feed(xml, datetime(2026, 6, 1, tzinfo=timezone.utc))

    assert events == []


def test_pipeline_fetch_includes_techmeme(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.techmeme, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("techmeme", days=1) == []
    assert calls == [3]
