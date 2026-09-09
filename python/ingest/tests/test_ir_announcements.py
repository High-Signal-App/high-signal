from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

from high_signal_ingest import pipeline
from high_signal_ingest.sources import ir, ir_announcements as releases

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


def test_release_uses_publication_date_and_retains_source(extractor):
    event = releases.announcement_event("ISSUER", URL, page(), NOW)
    assert event.published_at == datetime(2026, 9, 9, 11, 1, 4, tzinfo=timezone.utc)
    assert event.source_document.fetched_at == NOW
    assert event.source_document.raw_text == event.content
    assert event.title == "Issuer announces a new chip"
    assert event.source_url == URL
    assert pipeline._event_entity(event) == "ISSUER"


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
