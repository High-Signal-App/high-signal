"""News source adapter contracts."""

from __future__ import annotations

from high_signal_ingest.sources.news import _parse_feed
from high_signal_ingest.sources import china_news, scmp


def test_parse_atom_feed_link_href() -> None:
    xml = """<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>AI infra supply update</title>
        <link href="https://example.com/signal"/>
        <updated>2026-04-25T12:00:00Z</updated>
      </entry>
    </feed>
    """

    assert _parse_feed(xml) == [
        {
            "title": "AI infra supply update",
            "link": "https://example.com/signal",
            "pub": "2026-04-25T12:00:00Z",
        }
    ]


def test_scmp_feeds_are_targeted_china_feeds() -> None:
    ids = {str(feed["id"]) for feed in scmp.FEEDS}
    urls = {str(feed["rss"]) for feed in scmp.FEEDS}

    assert ids == {"scmp-china-tech", "scmp-china-economy"}
    assert urls == {
        "https://www.scmp.com/rss/320663/feed/",
        "https://www.scmp.com/rss/318421/feed/",
    }


def test_china_news_feeds_are_live_china_business_and_tech_feeds() -> None:
    ids = {str(feed["id"]) for feed in china_news.FEEDS}
    urls = {str(feed["rss"]) for feed in china_news.FEEDS}

    assert ids == {"technode", "pandaily", "cgtn-china", "cgtn-business"}
    assert urls == {
        "https://technode.com/feed/",
        "https://pandaily.com/feed/",
        "https://www.cgtn.com/subscribe/rss/section/china.xml",
        "https://www.cgtn.com/subscribe/rss/section/business.xml",
    }
