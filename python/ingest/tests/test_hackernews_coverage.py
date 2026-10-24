from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from high_signal_ingest.sources import hackernews as hn
from high_signal_ingest.sources import registered_feeds


@pytest.fixture(autouse=True)
def fixed_now(monkeypatch):
    monkeypatch.setattr(hn, "_now", lambda: datetime(2026, 10, 24, 12, tzinfo=timezone.utc))


def hit(index=1, *, url=None, points=100):
    return {
        "objectID": str(index),
        "title": "Acme launches its new inference platform",
        "created_at_i": int(hn._now().timestamp()) - 600,
        "points": points,
        "num_comments": 30,
        "author": "publicauthor",
        "url": url or f"https://publisher.com/story-{index}",
    }


def events(*hits):
    return hn.events_from_response({"hits": list(hits)}, hn._now() - timedelta(days=7))


def body_html(*, public=True, published="2026-10-23T12:00:00Z"):
    paragraphs = [
        f"Acme launches its new inference platform. Independent publication detail {i} records the launch scope, supported workloads, release timing and product limitations without promising adoption or financial results."
        for i in range(8)
    ]
    access = (
        ""
        if public
        else '<script type="application/ld+json">{"isAccessibleForFree":false}</script>'
    )
    return (
        f'<html><head><meta property="article:published_time" content="{published}"></head><body>{access}<article><h1>Acme launches its new inference platform</h1>'
        + "".join(f"<p>{p}</p>" for p in paragraphs)
        + "</article></body></html>"
    )


def test_or_alternatives_are_searched_separately_and_deduplicated(monkeypatch):
    now = hn._now()
    monkeypatch.setattr(
        hn,
        "QUERIES",
        (("GPU OR chip OR GPU", "story", 10), ("chip", "story", 10), ("", "show_hn", 8)),
    )
    specs = hn.query_specs(now - timedelta(days=7), now)
    assert [(q, tag, floor) for q, tag, floor, _ in specs] == [
        ("", "story", 10),
        ("GPU", "story", 10),
        ("chip", "story", 10),
        ("", "show_hn", 8),
    ]
    assert specs[0][3] == now - timedelta(hours=24)
    assert all(" OR " not in q for q, _, _, _ in specs)
    assert hn.PAGES * 100 == 200


def test_attention_event_preserves_discussion_and_never_gets_proof_credit():
    event = events(hit())[0]
    assert event.source == "hackernews"
    assert event.source_url.endswith("?id=1")
    assert event.source_document.parsed_fields == {
        "sourceClass": "attention_aggregator",
        "evidenceTier": "derived",
        "confidenceContribution": "none",
        "linkedOriginalUrl": "https://publisher.com/story-1",
        "discussionUrl": event.source_url,
        "points": 100,
        "commentCount": 30,
    }
    assert "Comments: 30" in event.content
    assert events(hit(points=9)) == []


def test_original_has_canonical_publisher_identity_and_exact_body_receipt(monkeypatch):
    observations = events(
        hit(1, url="https://www.publisher.com/story?utm_source=hn#comments"),
        hit(2, url="https://publisher.com/story"),
    )
    calls = []

    async def fetch(_client, url):
        calls.append(url)
        return SimpleNamespace(url=url, text=body_html())

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    originals = asyncio.run(hn.linked_originals(observations))
    assert calls == ["https://publisher.com/story"]
    assert len(originals) == 1
    event = originals[0]
    assert event.source == "news:hackernews-original:publisher.com"
    assert event.source_url == "https://publisher.com/story"
    assert event.published_at == datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
    document = event.source_document
    assert document.raw_text == event.content
    assert len(document.raw_text) >= 500
    assert document.raw_hash == hashlib.sha256(document.raw_text.encode()).hexdigest()
    assert document.parsed_fields["publicationDateBasis"] == "publisher_metadata"
    assert document.parsed_fields["discussionUrls"] == [e.source_url for e in observations]
    assert "confidenceContribution" not in document.parsed_fields
    assert "originating_evidence_id" not in document.parsed_fields


def test_original_fetches_are_capped_at_twenty_and_ranked_by_points(monkeypatch):
    observations = events(*(hit(i, points=100 + i) for i in range(30)))
    calls = []

    async def fetch(_client, url):
        calls.append(url)
        raise registered_feeds.PublicFeedFetchError("unavailable")

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    assert asyncio.run(hn.linked_originals(observations)) == []
    assert len(calls) == hn.MAX_ORIGINALS_PER_REFRESH == 20
    assert set(calls) == {f"https://publisher.com/story-{i}" for i in range(10, 30)}
    assert len(observations) == 30


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/private",
        "https://service.internal/a",
        "https://publisher.com/article?token=private",
        "https://x.com/account/status/1",
        "https://news.ycombinator.com/item?id=1",
    ],
)
def test_private_or_social_links_are_not_fetched(monkeypatch, url):
    async def fail(*_):
        pytest.fail("disallowed original must not be fetched")

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fail)
    assert asyncio.run(hn.linked_originals(events(hit(url=url)))) == []


@pytest.mark.parametrize(
    "html",
    [
        "<html><nav>Acme launches its new inference platform</nav></html>",
        body_html(public=False),
        "<article><h1>Othercorp unrelated headline</h1>"
        + "Othercorp unrelated coverage. " * 50
        + "</article>",
    ],
)
def test_unusable_nonpublic_or_unaligned_pages_never_become_news(monkeypatch, html):
    async def fetch(_client, url):
        return SimpleNamespace(url=url, text=html)

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    assert asyncio.run(hn.linked_originals(events(hit()))) == []


def test_one_publisher_failure_does_not_discard_other_originals(monkeypatch):
    async def fetch(_client, url):
        if url.endswith("story-1"):
            raise registered_feeds.PublicFeedFetchError("publisher unavailable")
        return SimpleNamespace(url=url, text=body_html())

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    result = asyncio.run(hn.linked_originals(events(hit(1), hit(2))))
    assert len(result) == 1
    assert result[0].source_url.endswith("story-2")


def test_two_redirects_to_one_canonical_article_merge_discussion_context(monkeypatch):
    async def fetch(_client, _url):
        return SimpleNamespace(url="https://publisher.com/canonical", text=body_html())

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    observations = events(hit(1), hit(2))
    originals = asyncio.run(hn.linked_originals(observations))
    assert len(originals) == 1
    assert originals[0].source_document.parsed_fields["discussionUrls"] == [
        e.source_url for e in observations
    ]


def test_publisher_failure_keeps_original_hn_event_and_broad_query_bounds(monkeypatch):
    calls = []

    class Client:
        def __init__(self, **_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def get(self, url, *, params):
            calls.append(params)
            return httpx.Response(200, json={"hits": [hit()]}, request=httpx.Request("GET", url))

    monkeypatch.setattr(hn.httpx, "Client", Client)
    monkeypatch.setattr(hn, "QUERIES", (("GPU OR chip", "story", 10),))

    async def unavailable(_, **_kwargs):
        raise RuntimeError("publisher outage")

    monkeypatch.setattr(hn, "linked_originals", unavailable)
    result = hn.fetch_all(7)
    assert len(result) == 1
    assert result[0].source == "hackernews"
    assert len(calls) == 3
    assert calls[0].get("query") is None
    assert calls[1]["query"] == "GPU"
    assert calls[2]["query"] == "chip"
    assert int(calls[0]["numericFilters"].split(",")[0].split(">")[1]) > int(
        calls[1]["numericFilters"].split(",")[0].split(">")[1]
    )
    assert all(p["hitsPerPage"] == 100 and p["page"] == 0 for p in calls)


@pytest.mark.parametrize(
    "published", [None, "2010-01-01T00:00:00Z", "2099-01-01T00:00:00Z", "not-a-date"]
)
def test_unknown_old_or_future_publication_date_never_gains_news_recency(monkeypatch, published):
    html = body_html()
    if published is None:
        html = html.replace(
            '<meta property="article:published_time" content="2026-10-23T12:00:00Z">', ""
        )
    else:
        html = html.replace("2026-10-23T12:00:00Z", published)

    async def fetch(_client, url):
        return SimpleNamespace(url=url, text=html)

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    observations = events(hit())
    assert asyncio.run(hn.linked_originals(observations)) == []
    assert observations[0].source == "hackernews"
    assert observations[0].source_document.parsed_fields["confidenceContribution"] == "none"


def test_explicit_article_jsonld_date_is_used_without_discovery_time_fallback(monkeypatch):
    html = body_html().replace(
        '<meta property="article:published_time" content="2026-10-23T12:00:00Z">',
        '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-22T12:00:00Z"}]}</script>',
    )

    async def fetch(_client, url):
        return SimpleNamespace(url=url, text=html)

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    observations = events(hit())
    result = asyncio.run(hn.linked_originals(observations))
    assert len(result) == 1
    assert result[0].published_at == datetime(2026, 10, 22, 12, tzinfo=timezone.utc)
    assert result[0].source_document.parsed_fields["discussionUrl"] == observations[0].source_url


def test_today_originals_are_not_starved_by_last_week_high_scores(monkeypatch):
    today = events(hit(100, points=10))[0]
    old = events(*(hit(i, points=10000 + i) for i in range(20)))
    for event in old:
        event.published_at = hn._now() - timedelta(days=6)
    calls = []

    async def fetch(_client, url):
        calls.append(url)
        raise registered_feeds.PublicFeedFetchError("unavailable")

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    assert asyncio.run(hn.linked_originals([*old, today])) == []
    assert len(calls) == 20
    assert calls[0] == "https://publisher.com/story-100"
    assert "https://publisher.com/story-0" not in calls


def test_equal_priority_selection_is_deterministic_and_prefers_recent_ties(monkeypatch):
    first, second = events(hit(1), hit(2))
    first.published_at = hn._now() - timedelta(hours=2)
    second.published_at = hn._now() - timedelta(hours=1)
    calls = []

    async def fetch(_client, url):
        calls.append(url)
        raise registered_feeds.PublicFeedFetchError("unavailable")

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    asyncio.run(hn.linked_originals([first, second]))
    assert calls == ["https://publisher.com/story-2", "https://publisher.com/story-1"]


def test_editorialized_hn_headline_is_not_published_as_publisher_copy(monkeypatch):
    observation = events(hit())[0]
    observation.title = "HN: Acme launches layoffs and fires 80 percent of workers"

    async def fetch(_client, url):
        return SimpleNamespace(url=url, text=body_html())

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    originals = asyncio.run(hn.linked_originals([observation]))
    assert len(originals) == 1
    assert originals[0].title == "Acme launches its new inference platform"
    assert "layoffs" not in originals[0].title
    assert originals[0].source_document.parsed_fields["publisherTitleBasis"] == "page_heading"
    assert "layoffs" in observation.title


def test_article_jsonld_headline_wins_over_generic_page_heading_and_og_title():
    metadata = hn._OriginalMetadata()
    metadata.feed(
        '<meta property="article:published_time" content="2026-10-23T12:00:00Z"><meta property="og:title" content="Acme company news"><h1>Acme</h1><script type="application/ld+json">{"@type":"NewsArticle","headline":"Acme launches its new inference platform","datePublished":"2026-10-23T12:00:00Z"}</script>'
    )
    assert metadata.title == "Acme launches its new inference platform"
    assert metadata.title_basis == "article_jsonld"
    assert metadata.published == datetime(2026, 10, 23, 12, tzinfo=timezone.utc)


def test_missing_publisher_headline_is_not_filled_from_hn(monkeypatch):
    async def fetch(_client, url):
        return SimpleNamespace(
            url=url,
            text=body_html().replace("<h1>Acme launches its new inference platform</h1>", ""),
        )

    monkeypatch.setattr(registered_feeds, "fetch_public_document", fetch)
    assert asyncio.run(hn.linked_originals(events(hit()))) == []


def test_nested_article_header_publication_time_uses_ancestor_semantics():
    metadata = hn._OriginalMetadata()
    metadata.feed(
        '<article class="post type-post"><header class="entry-header"><h1>Distributed SQLite release</h1><ul><li class="meta-date" itemprop="datePublished"><time datetime="2026-10-23T21:16:26-04:00">October23</time></li></ul></header></article>'
    )
    assert metadata.published == datetime(2026, 10, 24, 1, 16, 26, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "markup",
    [
        '<article><header><time datetime="2026-10-24T11:00:00Z">Clock</time></header></article>',
        '<article><header><span itemprop="dateModified"><time datetime="2026-10-24T11:00:00Z">Updated</time></span></header></article>',
        '<section id="comments"><article itemtype="https://schema.org/Comment"><header><time itemprop="datePublished" datetime="2026-10-24T11:00:00Z">Comment</time></header></article></section>',
        '<article><header><span itemprop="datePublished"><time itemprop="dateModified" datetime="2026-10-24T11:00:00Z">Updated</time></span></header></article>',
        '<article><footer><time itemprop="datePublished" datetime="2026-10-24T11:00:00Z">Footer</time></footer></article>',
    ],
)
def test_comments_generic_clocks_and_modified_times_cannot_supply_publication(markup):
    metadata = hn._OriginalMetadata()
    metadata.feed(markup)
    assert metadata.published is None


def test_later_comment_time_cannot_refresh_an_old_article_publication():
    metadata = hn._OriginalMetadata()
    metadata.feed(
        '<article><header><span itemprop="datePublished"><time datetime="2010-01-01T12:00:00Z">Old publication</time></span></header></article><section id="comments"><article><header><time itemprop="datePublished" datetime="2026-10-24T11:00:00Z">New comment</time></header></article></section>'
    )
    assert metadata.published == datetime(2010, 1, 1, 12, tzinfo=timezone.utc)


def test_observed_nitter_mirror_is_context_only_and_not_a_publisher():
    assert hn._original_url("https://nitter.click/publicaccount/status/123") is None
    assert hn._original_url("https://sub.nitter.click/publicaccount/status/123") is None
