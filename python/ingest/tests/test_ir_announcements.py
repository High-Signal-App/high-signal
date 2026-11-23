from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from xml.sax.saxutils import escape

import httpx
import pytest

from high_signal_ingest import pipeline
from high_signal_ingest.sources import ir, ir_announcements as releases
from high_signal_ingest.types import Entity

NOW = datetime(2026, 9, 9, 12, tzinfo=timezone.utc)
URL = "https://investors.example/news-releases/news-release-details/new-chip"


def page(date="2026-09-09T07:01:04-0400"):
    return (
        '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"'
        + date
        + '"}</script>'
    )


@pytest.fixture
def extractor(monkeypatch):
    import trafilatura

    monkeypatch.setattr(
        trafilatura,
        "bare_extraction",
        lambda *a, **k: SimpleNamespace(
            title="Issuer announces a new chip", text="Source article text. " * 40
        ),
    )


def test_links_are_same_origin_deduplicated_and_bounded():
    html = '<a href="https://other.example/news-releases/details/1">external</a>'
    html += '<a href="#fragment">self</a>'
    html += "".join(
        f'<a href="/news-releases/details/{i}#top">release</a><a href="/news-releases/details/{i}">duplicate</a>'
        for i in range(5)
    )
    assert releases.announcement_links(html, "https://investors.example/") == [
        f"https://investors.example/news-releases/details/{i}" for i in range(3)
    ]


def test_openai_index_links_are_allowed_only_on_openai_same_origin():
    html = '<a href="/index/introducing-product">OpenAI article</a>'
    html += '<a href="http://openai.com/index/insecure">insecure</a>'
    html += '<a href="https://other.example/index/unrelated">unrelated</a>'
    assert releases.announcement_links(html, "https://openai.com/") == [
        "https://openai.com/index/introducing-product"
    ]

    assert (
        releases.announcement_links(
            '<a href="/index/article">unrelated same-origin path</a>',
            "https://other.example/",
        )
        == []
    )


def test_release_uses_publication_date_and_retains_source(extractor):
    event = releases.announcement_event("ISSUER", URL, page(), NOW)
    assert event.published_at == datetime(2026, 9, 9, 11, 1, 4, tzinfo=timezone.utc)
    assert event.source_document.fetched_at == NOW
    assert event.source_document.raw_text == event.content
    assert event.title == "Issuer announces a new chip"
    assert event.source_url == URL
    assert pipeline._event_entity(event) == "ISSUER"


def test_openai_index_article_uses_existing_date_and_body_gates(extractor):
    url = "https://openai.com/index/introducing-product"
    event = releases.announcement_event("OPENAI", url, page(), NOW)
    assert event is not None
    assert event.source_url == url
    assert event.source_document.parsed_fields["documentKind"] == "issuer_announcement"


def test_configured_feed_date_fills_missing_page_metadata_and_rejects_conflicts(extractor):
    url = "https://newsroom.example/news/release"
    feed_url = "https://newsroom.example/releases.xml"
    event = releases.announcement_event(
        "ISSUER",
        url,
        "<html><body>Release article</body></html>",
        NOW,
        published_at_hint=NOW,
        publication_feed_url=feed_url,
    )

    assert event is not None
    assert event.published_at == NOW
    assert event.source_document.parsed_fields == {
        "documentKind": "issuer_announcement",
        "dateBasis": "configured_official_feed_pub_date",
        "publicationFeedUrl": feed_url,
    }
    conflict = releases.announcement_event(
        "ISSUER",
        url,
        page("2026-09-07T00:00:00Z"),
        NOW,
        published_at_hint=NOW,
        publication_feed_url=feed_url,
    )
    assert conflict is None

    matching_page = releases.announcement_event(
        "ISSUER",
        url,
        page("2026-09-09T00:00:00Z"),
        NOW,
        published_at_hint=NOW,
        publication_feed_url=feed_url,
    )
    assert matching_page is not None
    assert (
        matching_page.source_document.parsed_fields["dateBasis"] == "explicit_publication_metadata"
    )


def test_configured_ir_rss_is_joined_only_by_unique_ir_page_url():
    entity = Entity(
        id="NVDA",
        ticker="NVDA",
        name="NVIDIA Corporation",
        type="public",
        ir_url="https://investor.nvidia.com/",
    )
    source = {
        "id": "ir-nvidia",
        "type": "ir_page",
        "url": "https://investor.nvidia.com",
        "rss": "https://nvidianews.nvidia.com/releases.xml",
    }

    assert ir._ir_source_by_entity([entity], [source]) == {"NVDA": source}
    duplicate = entity.model_copy(update={"id": "NVDA-ALIAS"})
    assert ir._ir_source_by_entity([entity, duplicate], [source]) == {}


@pytest.mark.asyncio
async def test_poll_uses_configured_ir_rss_and_retains_exact_issuer_page(monkeypatch, extractor):
    published = datetime.now(timezone.utc).replace(microsecond=0)
    rss_date = format_datetime(published)
    article_url = "https://feed.example/news/nvidia-board-reinstates-jensen-huang"
    rss = f"""<?xml version="1.0"?>
    <rss version="2.0"><channel><title>NVIDIA releases</title><item>
      <title>NVIDIA Board Reinstates Jensen Huang as President, CEO and Board Director</title>
      <link>{escape(article_url)}</link><pubDate>{rss_date}</pubDate>
      <description>NVIDIA announced that Jensen Huang was reinstated.</description>
    </item></channel></rss>"""
    calls: list[str] = []

    async def no_dns(_url):
        return None

    older_page_events = [
        releases.announcement_event(
            "NVDA",
            f"https://investors.example/news-releases/details/{idx}",
            page((published - age).isoformat()),
            published,
        )
        for idx, age in enumerate((timedelta(hours=1), timedelta(hours=2), timedelta(days=1)))
    ]
    assert all(older_page_events)
    monkeypatch.setattr(
        ir,
        "retrieve_announcements",
        AsyncMock(return_value=older_page_events),
    )

    def handler(request):
        url = str(request.url)
        calls.append(url)
        if url == "https://investors.example/":
            return httpx.Response(200, text="<html><body>IR</body></html>")
        if url == "https://feed.example/releases.xml":
            return httpx.Response(200, text=rss, headers={"content-type": "application/rss+xml"})
        if url == article_url:
            return httpx.Response(
                200,
                text="<html><body>Release article</body></html>",
                headers={"content-type": "text/html"},
            )
        return httpx.Response(404)

    monkeypatch.setattr(ir.registered_feeds, "check_public_host", no_dns)
    monkeypatch.setattr(ir, "_extract_ir_text", lambda _: "Issuer directory snapshot")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        events = await ir.poll_ir_page_async(
            "NVDA",
            "https://investors.example/",
            client,
            rss_source={"id": "ir-nvidia", "rss": "https://feed.example/releases.xml"},
        )

    release = next(
        event
        for event in events
        if event.source_document
        and event.source_document.parsed_fields["documentKind"] == "issuer_announcement"
    )
    assert set(calls) == {
        "https://investors.example/",
        "https://feed.example/releases.xml",
        article_url,
    }
    assert release.source == "ir:NVDA"
    assert release.source_url == article_url
    assert release.primary_entity_id == "NVDA"
    assert release.published_at == published
    assert release.source_document.raw_text == release.content
    assert release.source_document.parsed_fields["dateBasis"] == "configured_official_feed_pub_date"
    assert (
        release.source_document.parsed_fields["publicationFeedUrl"]
        == "https://feed.example/releases.xml"
    )
    retained_announcements = [
        event
        for event in events
        if event.source_document
        and event.source_document.parsed_fields["documentKind"] == "issuer_announcement"
    ]
    assert [event.source_url for event in retained_announcements] == [
        article_url,
        "https://investors.example/news-releases/details/0",
        "https://investors.example/news-releases/details/1",
    ]


@pytest.mark.asyncio
async def test_poll_does_not_fetch_ir_rss_links_from_another_origin(monkeypatch, extractor):
    published = datetime.now(timezone.utc).replace(microsecond=0)
    rss_date = format_datetime(published)
    calls: list[str] = []
    rss = f"""<?xml version="1.0"?>
    <rss version="2.0"><channel><title>NVIDIA releases</title><item>
      <title>NVIDIA announcement</title>
      <link>https://other.example/news/release</link><pubDate>{rss_date}</pubDate>
    </item></channel></rss>"""

    async def no_dns(_url):
        return None

    def handler(request):
        url = str(request.url)
        calls.append(url)
        if url == "https://investors.example/":
            return httpx.Response(200, text="<html><body>IR</body></html>")
        if url == "https://feed.example/releases.xml":
            return httpx.Response(200, text=rss, headers={"content-type": "application/rss+xml"})
        return httpx.Response(404)

    monkeypatch.setattr(ir.registered_feeds, "check_public_host", no_dns)
    monkeypatch.setattr(ir, "_extract_ir_text", lambda _: "Issuer directory snapshot")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await ir.poll_ir_page_async(
            "NVDA",
            "https://investors.example/",
            client,
            rss_source={"id": "ir-nvidia", "rss": "https://feed.example/releases.xml"},
        )

    assert "https://other.example/news/release" not in calls


@pytest.mark.asyncio
async def test_poll_fetches_rss_when_ir_index_fails_and_ignores_http_links(monkeypatch, extractor):
    published = datetime.now(timezone.utc).replace(microsecond=0)
    rss_date = format_datetime(published)
    article_url = "https://feed.example/news/nvidia-board-release"
    rss = f"""<?xml version="1.0"?>
    <rss version="2.0"><channel><title>NVIDIA releases</title>
      <item><title>Insecure</title><link>http://feed.example/news/insecure</link>
        <pubDate>{rss_date}</pubDate></item>
      <item><title>Valid release</title><link>{escape(article_url)}</link>
        <pubDate>{rss_date}</pubDate></item>
    </channel></rss>"""
    calls: list[str] = []

    async def no_dns(_url):
        return None

    def handler(request):
        url = str(request.url)
        calls.append(url)
        if url == "https://investors.example/":
            return httpx.Response(403)
        if url == "https://feed.example/releases.xml":
            return httpx.Response(200, text=rss, headers={"content-type": "application/rss+xml"})
        if url == article_url:
            return httpx.Response(
                200,
                text="<html><body>Release article</body></html>",
                headers={"content-type": "text/html"},
            )
        return httpx.Response(404)

    monkeypatch.setattr(ir.registered_feeds, "check_public_host", no_dns)
    monkeypatch.setattr(ir, "_extract_ir_text", lambda _: "Issuer directory snapshot")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        events = await ir.poll_ir_page_async(
            "NVDA",
            "https://investors.example/",
            client,
            rss_source={"id": "ir-nvidia", "rss": "https://feed.example/releases.xml"},
        )

    assert set(calls) == {
        "https://investors.example/",
        "https://feed.example/releases.xml",
        article_url,
    }
    assert len(events) == 1
    assert events[0].source_url == article_url


@pytest.mark.asyncio
async def test_poll_rejects_rss_feed_redirect_to_another_host(monkeypatch, extractor):
    calls: list[str] = []

    async def no_dns(_url):
        return None

    def handler(request):
        url = str(request.url)
        calls.append(url)
        if url == "https://investors.example/":
            return httpx.Response(200, text="<html><body>IR</body></html>")
        if url == "https://feed.example/releases.xml":
            return httpx.Response(
                302, headers={"location": "https://redirect.example/releases.xml"}
            )
        if url == "https://redirect.example/releases.xml":
            return httpx.Response(200, text="<rss><channel /></rss>")
        return httpx.Response(404)

    monkeypatch.setattr(ir.registered_feeds, "check_public_host", no_dns)
    monkeypatch.setattr(ir, "_extract_ir_text", lambda _: "Issuer directory snapshot")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=True
    ) as client:
        events = await ir.poll_ir_page_async(
            "NVDA",
            "https://investors.example/",
            client,
            rss_source={"id": "ir-nvidia", "rss": "https://feed.example/releases.xml"},
        )

    assert "https://redirect.example/releases.xml" in calls
    assert all(
        not event.source_document
        or event.source_document.parsed_fields.get("documentKind") != "issuer_announcement"
        for event in events
    )


@pytest.mark.parametrize(
    "html",
    [
        page("2026-08-01"),
        page("2026-09-10"),
        page("nonsense"),
        '<script type="application/ld+json">{"dateModified":"2026-09-09"}</script>',
        "no metadata",
    ],
)
def test_missing_old_future_or_modified_dates_do_not_become_today(html, extractor):
    assert releases.announcement_event("ISSUER", URL, html, NOW) is None


def test_thin_article_is_withheld(monkeypatch):
    import trafilatura

    monkeypatch.setattr(
        trafilatura,
        "bare_extraction",
        lambda *a, **k: SimpleNamespace(title="Headline", text="short"),
    )
    assert releases.announcement_event("ISSUER", URL, page(), NOW) is None


@pytest.mark.asyncio
async def test_poll_fetches_release_and_marks_index_discovery_only(monkeypatch, extractor):
    today = datetime.now(timezone.utc).isoformat()
    index = '<a href="/news-releases/news-release-details/new-chip">Release</a>'
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, text=page(today) if str(request.url) == URL else index)

    monkeypatch.setattr(ir, "_extract_ir_text", lambda _: "Issuer directory snapshot")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        events = await ir.poll_ir_page_async("ISSUER", "https://investors.example/", client)
    assert calls == ["https://investors.example/", URL]
    assert len(events) == 2
    assert pipeline._event_entity(events[0]) == "ISSUER"
    assert pipeline._event_entity(events[1]) is None
    assert events[1].source_document.parsed_fields["discoveryOnly"] is True


@pytest.mark.asyncio
async def test_release_redirect_does_not_fetch_another_origin(extractor):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://other.example/release"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=True
    ) as client:
        events = await releases.retrieve_announcements(
            "ISSUER", "https://investors.example/", f'<a href="{URL}">release</a>', client
        )
    assert events == []
    assert calls == [URL]
