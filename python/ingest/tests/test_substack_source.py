from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest import audit
from high_signal_ingest.sources import registered_feeds

from high_signal_ingest import pipeline
from high_signal_ingest.sources import substack
from high_signal_ingest.sources.substack import SubstackFeed


def test_events_from_feed_filters_to_relevant_items() -> None:
    xml = """<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>AI agents change developer workflows</title>
          <link>https://example.substack.com/p/agents</link>
          <description>Teams are changing product and pricing around AI agents.</description>
          <pubDate>Sun, 31 May 2026 08:00:00 +0000</pubDate>
        </item>
        <item>
          <title>Unrelated travel notes</title>
          <link>https://example.substack.com/p/travel</link>
          <description>A personal travel diary.</description>
          <pubDate>Sun, 31 May 2026 08:00:00 +0000</pubDate>
        </item>
      </channel>
    </rss>
    """

    events = substack.events_from_feed(
        SubstackFeed("example", "Example", "https://example.substack.com/feed"),
        xml,
        datetime(2026, 5, 31, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "substack:example"
    assert events[0].source_url == "https://example.substack.com/p/agents"


def test_pipeline_fetch_includes_substack(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.substack, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("substack", days=1) == []
    assert calls == [7]


@pytest.mark.parametrize("enabled", [True, False])
def test_managed_publication_cannot_be_duplicated_or_bypass_pause(monkeypatch, enabled) -> None:
    monkeypatch.setattr(
        audit,
        "fetch_feed_sources",
        lambda: [
            {
                "id": "feed-managed",
                "feedUrl": "https://publisher.example.org/feed/",
                "enabled": enabled,
            }
        ],
    )
    requested: list[str] = []
    client = httpx.Client

    def respond(request):
        requested.append(str(request.url))
        return httpx.Response(200, text="<rss version='2.0'><channel/></rss>")

    monkeypatch.setattr(
        substack.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    assert (
        substack.fetch_all(
            feeds=[
                SubstackFeed("managed", "Managed", "https://www.publisher.example.org/feed"),
                SubstackFeed("untouched", "Untouched", "https://other.example.org/feed"),
            ]
        )
        == []
    )
    assert requested == ["https://other.example.org/feed"]


def test_registry_outage_cannot_resume_legacy_substack_feeds(monkeypatch) -> None:
    monkeypatch.setattr(audit, "fetch_feed_sources", lambda: None)
    with pytest.raises(registered_feeds.PublicFeedFetchError, match="unavailable"):
        substack.fetch_all()
