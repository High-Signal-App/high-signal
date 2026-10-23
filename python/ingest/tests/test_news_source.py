"""News source adapter contracts."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx

from high_signal_ingest.sources.news import _parse_feed
from high_signal_ingest.sources import china_news, news, scmp


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


def test_feed_retains_full_article_text_without_html_or_script() -> None:
    xml = """<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><item>
        <title>New developer tools</title><link>https://example.com/tools</link>
        <description>Short preview</description>
        <content:encoded><![CDATA[<p>Developers &amp; founders</p><p>can run agents locally.</p>
          <script>tracking()</script><style>.hidden { display:none }</style>]]></content:encoded>
      </item></channel></rss>"""
    assert _parse_feed(xml)[0]["content"] == "Developers & founders can run agents locally."


def test_curated_newsletters_reach_intake_and_keep_feed_text_when_page_fails(monkeypatch) -> None:
    sources = [
        {"id": "newsletter", "type": "mailing_list", "tier": 3, "rss": "https://writer.test/feed"},
        {"id": "outlet", "type": "news_outlet", "tier": 2, "rss": "https://outlet.test/feed"},
        {"id": "low-tier", "type": "news_outlet", "tier": 3, "rss": "https://skip.test/feed"},
        {"id": "unranked", "type": "mailing_list", "rss": "https://unranked.test/feed"},
        {"id": "forum", "type": "forum", "tier": 1, "rss": "https://forum.test/feed"},
        {"id": "no-feed", "type": "mailing_list", "tier": 3, "rss": None},
    ]
    body = "Developers are moving production agents onto local infrastructure with reproducible deployment tools and measurable operating costs."
    published = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    requested: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path != "/feed":
            return httpx.Response(503)
        return httpx.Response(
            200,
            text=f"""<rss version="2.0"><channel><item>
              <title>Developer agents launch locally</title>
              <link>https://{request.url.host}/article</link><pubDate>{published}</pubDate>
              <description><![CDATA[<p>{body}</p>]]></description>
            </item></channel></rss>""",
        )

    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: sources)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    events = asyncio.run(news.fetch_all_async())
    assert {event.source for event in events} == {"news:newsletter", "news:outlet"}
    assert all(event.content == body for event in events)
    assert all(event.source_url.endswith("/article") for event in events)
    assert {httpx.URL(url).host for url in requested} == {"writer.test", "outlet.test"}


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
