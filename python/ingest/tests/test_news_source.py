"""News source adapter contracts."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
import pytest

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
        {
            "id": "newsletter",
            "type": "mailing_list",
            "tier": 3,
            "rss": "https://writer.example.org/feed",
        },
        {
            "id": "outlet",
            "type": "news_outlet",
            "tier": 2,
            "rss": "https://outlet.example.org/feed",
        },
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

    async def public_dns(_url):
        return None

    monkeypatch.setattr(news.registered_feeds, "check_public_host", public_dns)
    monkeypatch.setattr(news.audit, "push_ingest_runs", lambda _runs: True)
    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: sources)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    events = asyncio.run(news.fetch_all_async(source_ids=["newsletter", "outlet"]))
    assert {event.source for event in events} == {"news:newsletter", "news:outlet"}
    assert all(event.content == body for event in events)
    assert all(event.source_url.endswith("/article") for event in events)
    assert {httpx.URL(url).host for url in requested} == {
        "writer.example.org",
        "outlet.example.org",
    }


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


def test_curated_failures_and_stale_success_have_distinct_named_fetch_receipts(monkeypatch) -> None:
    sources = [
        {"id": key, "type": "blog", "tier": 2, "rss": f"https://{key}.example.org/feed"}
        for key in ["blocked", "html", "quiet"]
    ]
    receipts: list[dict] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.host == "blocked.example.org":
            return httpx.Response(403)
        if request.url.host == "html.example.org":
            return httpx.Response(200, text="<html>Not a feed</html>")
        return httpx.Response(
            200,
            text="""<rss version="2.0"><channel><item>
            <title>Old release</title><link>https://quiet.example.org/article</link>
            <pubDate>Wed, 23 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>""",
        )

    async def public_dns(_url):
        return None

    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: sources)
    monkeypatch.setattr(news.audit, "fetch_feed_sources", lambda: [])
    monkeypatch.setattr(news.audit, "push_ingest_runs", lambda runs: receipts.extend(runs) or True)
    monkeypatch.setattr(news.registered_feeds, "check_public_host", public_dns)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    assert asyncio.run(news.fetch_all_async()) == []
    by_source = {r["source"]: r for r in receipts}
    assert by_source["news:blocked"]["errors"] == 1
    assert by_source["news:blocked"]["errorSample"] == "Publisher returned HTTP 403"
    assert by_source["news:html"]["errors"] == 1
    assert by_source["news:quiet"]["errors"] == 0
    assert "2026-09-23" in by_source["news:quiet"]["notes"]


def test_archive_seed_runs_through_normal_news_collection_and_pause(monkeypatch) -> None:
    source = {
        "id": "public-archive",
        "type": "mailing_list",
        "tier": 3,
        "archive": {"url": "https://publisher.example.org/", "kind": "beehiiv"},
        "feed_aliases": ["https://publisher.example.org/old-feed"],
    }
    requested: list[str] = []
    published = datetime.now(timezone.utc).isoformat()

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path == "/":
            return httpx.Response(200, text='<a href="/p/current">Current</a>')
        return httpx.Response(
            200,
            text=f'''<h1>Publisher launches tools</h1>
            <meta property="article:published_time" content="{published}">
            <article><p>{"Publisher launched verified infrastructure tools for deployment. " * 20}</p></article>''',
        )

    async def public_dns(_url):
        return None

    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: [source])
    monkeypatch.setattr(news.audit, "fetch_feed_sources", lambda: [])
    monkeypatch.setattr(news.audit, "push_ingest_runs", lambda _runs: True)
    monkeypatch.setattr(news.registered_feeds, "check_public_host", public_dns)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    events = asyncio.run(news.fetch_all_async())
    assert len(events) == 1 and events[0].source == "news:public-archive"
    requested.clear()
    monkeypatch.setattr(
        news.audit,
        "fetch_feed_sources",
        lambda: [{"id": "paused", "feedUrl": source["feed_aliases"][0], "enabled": False}],
    )
    assert asyncio.run(news.fetch_all_async(source_ids=["public-archive"])) == []
    assert requested == []


def test_extraction_excludes_navigation_and_preserves_paraphrased_article() -> None:
    article = "The company is bringing smaller language models to customer hardware. " * 12
    html = (
        "<html><body><nav><p>Nvidia woos Europeans with open models.</p></nav>"
        f"<article><h1>IBM CEO backs on-prem models</h1><p>{article}</p></article>"
        "<aside>Related stories about Nvidia</aside></body></html>"
    )
    text = news._extract_article_text(html, "IBM CEO backs on-prem models")
    assert "customer hardware" in text
    assert "Nvidia" not in text
    assert news.article_text_is_aligned(article, "IBM CEO backs on-prem models")


def test_mismatched_scrape_falls_back_to_aligned_feed_body(monkeypatch) -> None:
    title = "IBM CEO backs open weight models on customer hardware"
    feed_body = (
        "IBM is bringing open weight language models to customer hardware for local deployment."
    )
    navigation = (
        "AI - Nvidia woos Europeans. - Jensen shows robots. - Nvidia builds trailer parks. " * 20
    )

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/feed":
            return httpx.Response(
                200,
                text=f"""<rss version="2.0"><channel><item>
              <title>{title}</title><link>https://publisher.example.org/article</link>
              <pubDate>Sat, 24 Oct 2026 08:00:00 GMT</pubDate>
              <description>{feed_body}</description></item></channel></rss>""",
            )
        return httpx.Response(200, text=f"<html><article><p>{navigation}</p></article></html>")

    async def public_dns(_url):
        return None

    monkeypatch.setattr(news.registered_feeds, "check_public_host", public_dns)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await news.fetch_rss_async(
                {"id": "publisher", "rss": "https://publisher.example.org/feed"},
                datetime(2026, 10, 23, tzinfo=timezone.utc),
                client,
                asyncio.Semaphore(2),
                fetch_body=True,
            )

    [event] = asyncio.run(run())
    assert event.content == feed_body
    assert not news.article_text_is_aligned(navigation, title)
    assert not news.article_text_is_aligned("Microsoft announced an unrelated product.", title)


@pytest.mark.parametrize(
    "body",
    [
        None,
        "",
        "IBM is bringing models to customer hardware.",
        "AI - Nvidia woos Europeans. - Jensen shows robots. - Nvidia builds trailer parks. " * 20,
        "Please log in to continue. IBM article. " * 30,
    ],
)
def test_failed_thin_navigation_or_challenge_body_cannot_refresh_a_receipt(body):
    assert (
        news._article_receipt(
            body,
            "IBM CEO backs models on customer hardware",
            "https://publisher.example/article",
            datetime.now(timezone.utc),
        )
        is None
    )


def test_successful_article_refresh_preserves_event_identity_and_supplies_content_receipt(
    monkeypatch,
):
    import hashlib

    from high_signal_ingest.audit import _source_document_payload

    title = "IBM CEO backs models on customer hardware"
    body = (
        "IBM announced a deployment option for models running on customer hardware. "
        "The company described the implementation, supported systems and rollout schedule. "
        "Customers can evaluate the software on their own infrastructure before production deployment. "
    ) * 4
    published = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    feed = f"""<rss version="2.0"><channel><item><title>{title}</title>
      <link>https://publisher.example/article?utm_source=feed</link><pubDate>{published}</pubDate>
      <description>Short feed preview remains available when article retrieval fails.</description>
      </item></channel></rss>"""
    responses = iter(["", body, ""])

    async def extract(*_args, **_kwargs):
        return next(responses)

    async def public_dns(_url):
        return None

    monkeypatch.setattr(news, "_extract_body", extract)
    monkeypatch.setattr(news.registered_feeds, "check_public_host", public_dns)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, text=feed))
        ) as client:
            events = []
            for _ in range(3):
                [event] = await news.fetch_rss_async(
                    {"id": "publisher", "rss": "https://publisher.example/feed"},
                    datetime(2026, 1, 1, tzinfo=timezone.utc),
                    client,
                    asyncio.Semaphore(2),
                    fetch_body=True,
                )
                events.append(event)
            return events

    initial, repaired, unavailable = asyncio.run(run())
    assert len({event.id for event in [initial, repaired, unavailable]}) == 1
    assert len({event.raw_hash for event in [initial, repaired, unavailable]}) == 1
    assert initial.source_document is None and unavailable.source_document is None
    assert repaired.source_document is not None
    assert repaired.source_document.raw_text == body
    assert repaired.source_document.raw_hash == hashlib.sha256(body.encode()).hexdigest()
    assert repaired.source_document.document_key is None
    assert repaired.source_document.canonical_url == repaired.source_url
    payload = _source_document_payload(repaired)
    assert payload["rawText"] == body
    assert payload["rawHash"] != repaired.raw_hash
    assert payload["parsedFields"] == {
        "documentKind": "news_article",
        "retrievedFrom": "public_article_page",
    }


@pytest.mark.parametrize("flag", [False, "false"])
def test_article_extraction_respects_explicit_subscriber_access_metadata(flag):
    import json

    body = "IBM announced models for running on customer hardware with deployment support. " * 20
    metadata = {
        "@context": "https://schema.org",
        "@graph": [{"@type": "NewsArticle", "isAccessibleForFree": flag}],
    }
    html = (
        f'<html><script type="application/ld+json">{json.dumps(metadata)}</script>'
        f"<article><h1>IBM announced customer models</h1><p>{body}</p></article></html>"
    )
    assert news._extract_article_text(html, "IBM announced customer models") == ""
