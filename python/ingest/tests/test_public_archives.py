from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest.sources import public_archives as archives, registered_feeds as feeds


def test_archive_listing_selectors_exclude_navigation_cross_origin_and_duplicates() -> None:
    assert archives.archive_links(
        """<nav><a href="/the-batch/about">About</a></nav>
        <article><h3>Current issue</h3><a href="/the-batch/issue-376"></a></article>
        <a href="/the-batch/issue-376">Read</a>
        <a href="https://other.example.org/the-batch/issue-999">Other site</a>""",
        "https://publisher.example.org/the-batch",
        "batch",
    ) == ["https://publisher.example.org/the-batch/issue-376"]
    assert archives.archive_links(
        """<a href="/2026/paid-update/">Paid update</a>
        <li class="wp-block-post category-articles"><h2><a href="/2026/free-article/">Free</a></h2>
        <time datetime="2026-10-21T10:00:00Z"></time></li>""",
        "https://publisher.example.org/category/articles/",
        "stratechery",
    ) == ["https://publisher.example.org/2026/free-article/"]
    assert archives.archive_links(
        """<a href="/archive">Archive</a><a href="/p/current">Current</a>
        <a href="/p/current?subscriber_id=private">Private</a>""",
        "https://publisher.example.org/",
        "beehiiv",
    ) == ["https://publisher.example.org/p/current"]


def test_article_metadata_requires_publication_date_and_preserves_actual_date() -> None:
    assert archives.article_metadata(
        """<meta property="og:title" content="New agent tools">
        <meta property="article:published_time" content="2026-10-21T10:00:00Z">
        <meta property="article:modified_time" content="2026-10-24T10:00:00Z">""",
        "beehiiv",
    ) == ("New agent tools", datetime(2026, 10, 21, 10, tzinfo=timezone.utc))
    assert (
        archives.article_metadata(
            """<h1>New agent tools</h1>
        <meta property="article:modified_time" content="2026-10-24T10:00:00Z">""",
            "beehiiv",
        )
        is None
    )
    assert (
        archives.article_metadata(
            """<h1>Subscriber article</h1><script type="application/ld+json">
        {"@type":"Article","datePublished":"2026-10-21","isAccessibleForFree":false}
        </script>""",
            "beehiiv",
        )
        is None
    )
    assert archives.article_metadata(
        """<h1>Published article</h1><script type="application/ld+json">
        {"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-21T10:00:00Z"}]}
        </script>""",
        "batch",
    ) == ("Published article", datetime(2026, 10, 21, 10, tzinfo=timezone.utc))


def test_cerebras_uses_heading_date_and_never_incidental_body_or_modified_date() -> None:
    assert archives.article_metadata(
        """<meta property="article:modified_time" content="2026-10-24">
        <section><p>Oct 16 2026</p><h1>A Smarter Model</h1></section>
        <article><p>Oct 23 2026</p></article>""",
        "cerebras",
    ) == ("A Smarter Model", datetime(2026, 10, 16, tzinfo=timezone.utc))
    assert (
        archives.article_metadata("<h1>A Smarter Model</h1><p>Oct 23 2026</p>", "cerebras") is None
    )


@pytest.mark.parametrize("types", ["null", "42", "{}", '[null, {}, "Article"]'])
def test_malformed_structured_types_do_not_abort_collection(types: str) -> None:
    assert archives.article_metadata(
        '<h1>Public article</h1><script type="application/ld+json">'
        f'{{"@type":{types}}}</script>'
        '<meta property="article:published_time" content="2026-10-24">',
        "beehiiv",
    ) == ("Public article", datetime(2026, 10, 24, tzinfo=timezone.utc))


def test_recurring_archive_fetch_admits_only_current_dated_public_articles(monkeypatch) -> None:
    requested: list[str] = []

    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    current = since.isoformat()

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        path = request.url.path
        if path == "/":
            return httpx.Response(
                200,
                text="".join(
                    f'<a href="/p/{slug}">{slug}</a>'
                    for slug in [
                        "current",
                        "current",
                        "old",
                        "undated",
                        "future",
                        "paid",
                        "blocked",
                        "redirect",
                    ]
                ),
            )
        if path == "/p/blocked":
            return httpx.Response(403)
        if path == "/p/redirect":
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/private"})
        date = {
            "/p/current": current,
            "/p/old": "2020-01-01",
            "/p/future": "2099-01-01",
            "/p/paid": current,
        }.get(path)
        return httpx.Response(
            200,
            text="<h1>Publisher launches agent tools</h1>"
            + (f'<meta property="article:published_time" content="{date}">' if date else "")
            + (
                '<script type="application/ld+json">{"isAccessibleForFree":false}</script>'
                if path == "/p/paid"
                else ""
            )
            + "<p>Publisher launched documented agent tools with reproducible benchmarks.</p>",
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await archives.fetch_archive(
                {"archive": {"url": "https://publisher.example.org/", "kind": "beehiiv"}},
                since,
                client,
                asyncio.Semaphore(3),
                lambda _html, title: title + ". " + "Documented details. " * 20,
            )

    result = asyncio.run(run())
    assert len(result.items) == 1
    assert result.items[0]["link"] == "https://publisher.example.org/p/current"
    assert len(result.errors) == 2
    assert "Publisher returned HTTP 403" in result.errors
    assert requested.count("https://publisher.example.org/p/current") == 1
    assert all("127.0.0.1" not in url for url in requested)


def test_archive_listing_caps_the_number_of_article_fetches() -> None:
    links = "".join(f'<a href="/blog/article-{index}">Article</a>' for index in range(100))
    assert (
        len(archives.archive_links(links, "https://publisher.example.org/blog", "cerebras")) == 12
    )
    with pytest.raises(feeds.PublicFeedFetchError, match="no supported"):
        archives.archive_links(
            '<a href="/subscribe">Subscribe</a>', "https://publisher.example.org/", "beehiiv"
        )
