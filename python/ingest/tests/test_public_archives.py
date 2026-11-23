from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

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


def test_firstround_selects_article_cards_not_navigation_or_glossary() -> None:
    html = """<a href="/about/">About</a>
    <article><a href="/unmarked/">Unmarked</a></article>
    <article data-post-card-wrapper>
      <a href="/inside-thiel-fellowship/">Read</a>
      <a href="/inside-thiel-fellowship/">Title</a>
      <a href="/glossary/moat/">Glossary</a>
      <a href="https://other.example.org/offsite/">Offsite</a>
      <a href="/private/?subscriber=123">Private</a>
    </article>"""
    assert archives.archive_links(
        html, "https://review.firstround.com/articles/", "firstround"
    ) == ["https://review.firstround.com/inside-thiel-fellowship/"]


def test_alphasignal_cards_bind_day_precision_dates_to_same_first_party_card() -> None:
    html = """<nav><a href="/email/aaaaaaaaaaaaaaaa">Not an issue card</a></nav>
    <section aria-label="November 2026"><h2>November 2026</h2><ul>
      <li><a href="/email/1b7a5d6be16510c2"><span class="type-archive-date">Nov 23<span>Mon</span></span>
        <span class="type-newsletter-card-title">OpenAI MedChemBench</span></a></li>
      <li><a href="/email/1b7a5d6be16510c2"><span class="type-archive-date">Nov 23<span>Mon</span></span>
        <span class="type-newsletter-card-title">Duplicate</span></a></li>
      <li><a href="/email/2222222222222222"><span class="type-archive-date">Nov 22<span>Mon</span></span>
        <span class="type-newsletter-card-title">Wrong weekday</span></a></li>
      <li><a href="/email/short"><span class="type-archive-date">Nov 22<span>Sun</span></span>
        <span class="type-newsletter-card-title">Wrong permalink</span></a></li>
      <li><a href="https://outside.example.org/email/3333333333333333"><span class="type-archive-date">Nov 22<span>Sun</span></span>
        <span class="type-newsletter-card-title">Offsite</span></a></li>
      <li><a href="/email/4444444444444444?subscriber_id=private"><span class="type-archive-date">Nov 22<span>Sun</span></span>
        <span class="type-newsletter-card-title">Private query</span></a></li>
      <li><a href="/email/5555555555555555"><span class="type-archive-date">Oct 31<span>Sat</span></span>
        <span class="type-newsletter-card-title">Wrong month</span></a></li>
    </ul></section>
    <section aria-label="October 2026"><ul><li>
      <a href="/email/6666666666666666"><span class="type-archive-date">Oct 31<span>Sat</span></span>
        <span class="type-newsletter-card-title">October Issue</span></a></li>
    </ul></section>"""

    cards = archives.alphasignal_archive_cards(html, "https://alphasignal.ai/archive")

    assert [(card.link, card.title, card.published, card.precision) for card in cards] == [
        (
            "https://alphasignal.ai/email/1b7a5d6be16510c2",
            "OpenAI MedChemBench",
            datetime(2026, 11, 23, tzinfo=timezone.utc),
            "day",
        ),
        (
            "https://alphasignal.ai/email/6666666666666666",
            "October Issue",
            datetime(2026, 10, 31, tzinfo=timezone.utc),
            "day",
        ),
    ]


def test_alphasignal_archive_fetch_requires_public_matching_permalink_and_body(monkeypatch) -> None:
    requested: list[str] = []
    today = datetime.now(timezone.utc).date()
    today_label = today.strftime("%b %d %a")
    month_label = today.strftime("%B %Y")
    since = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    listing = f"""<section aria-label="{month_label}"><ul>
      <li><a href="/email/1111111111111111"><span class="type-archive-date">{today_label}</span>
        <span class="type-newsletter-card-title">OpenAI MedChemBench</span></a></li>
      <li><a href="/email/2222222222222222"><span class="type-archive-date">{today_label}</span>
        <span class="type-newsletter-card-title">Card title</span></a></li>
      <li><a href="/email/3333333333333333"><span class="type-archive-date">{today_label}</span>
        <span class="type-newsletter-card-title">Private issue</span></a></li>
      <li><a href="/email/4444444444444444"><span class="type-archive-date">{today_label}</span>
        <span class="type-newsletter-card-title">Redirected issue</span></a></li>
      <li><a href="/email/6666666666666666"><span class="type-archive-date">{today_label}</span>
        <span class="type-newsletter-card-title">Login wall</span></a></li>
      <li><a href="/email/7777777777777777"><span class="type-archive-date">unknown date</span>
        <span class="type-newsletter-card-title">Undated card</span></a></li>
    </ul></section>"""

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path == "/archive":
            return httpx.Response(200, text=listing)
        if request.url.path == "/email/4444444444444444":
            return httpx.Response(
                302, headers={"Location": "https://alphasignal.ai/email/5555555555555555"}
            )
        page_titles = {
            "/email/1111111111111111": "OpenAI MedChemBench",
            "/email/2222222222222222": "Different page title",
            "/email/3333333333333333": "Private issue",
            "/email/5555555555555555": "Redirected issue",
            "/email/6666666666666666": "Login wall",
        }
        page = f'<meta property="og:title" content="{page_titles[request.url.path]}">'
        if request.url.path == "/email/3333333333333333":
            page += '<script type="application/ld+json">{"@type":"Article","isAccessibleForFree":false}</script>'
        return httpx.Response(200, text=page + "<article>Public article content</article>")

    def extract(html: str, title: str) -> str:
        if "Private issue" in title:
            return "Public body. " * 25
        if "Login wall" in title:
            return "Sign in to continue. " * 25
        return title + ". Public AI research with reproducible details. " * 20

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await archives.fetch_archive(
                {"archive": {"url": "https://alphasignal.ai/archive", "kind": "alphasignal"}},
                since,
                client,
                asyncio.Semaphore(3),
                extract,
            )

    result = asyncio.run(run())
    assert len(result.items) == 1
    assert result.items[0]["link"] == "https://alphasignal.ai/email/1111111111111111"
    assert result.items[0]["published"] == since
    assert result.items[0]["published_precision"] == "day"
    assert result.items[0]["published_normalization"] == "date_only_at_00:00_utc"
    assert result.items[0]["published_evidence"] == "first_party_archive_card"
    assert result.items[0]["published_evidence_url"] == "https://alphasignal.ai/archive"
    assert requested.count("https://alphasignal.ai/archive") == 1
    assert "https://alphasignal.ai/email/5555555555555555" in requested
    assert result.dated == 1
    assert result.listed == 5
    assert result.rejected_listed == 1
    assert result.latest_listed == since
    assert sorted(result.errors) == sorted(
        [
            "AlphaSignal issue is not declared publicly accessible",
            "AlphaSignal issue redirected to a different permalink",
            "AlphaSignal issue title did not match its archive card",
            "AlphaSignal archive rejected 1 malformed or unsupported issue card(s)",
            "Public archive article contained no usable public body",
        ]
    )


def test_alphasignal_day_precision_includes_previous_calendar_day_at_0230z(monkeypatch) -> None:
    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
    since = datetime.combine(yesterday, datetime.min.time(), timezone.utc) + timedelta(
        hours=2, minutes=30
    )
    requested: list[str] = []

    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    listing = f'''<section aria-label="{yesterday.strftime("%B %Y")}"><ul>
      <li><a href="/email/1111111111111111"><span class="type-archive-date">{yesterday.strftime("%b %d %a")}</span>
        <span class="type-newsletter-card-title">Yesterday issue</span></a></li>
    </ul></section>'''

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        if request.url.path == "/archive":
            return httpx.Response(200, text=listing)
        return httpx.Response(
            200,
            text='<meta property="og:title" content="Yesterday issue"><article>Public article</article>',
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await archives.fetch_archive(
                {"archive": {"url": "https://alphasignal.ai/archive", "kind": "alphasignal"}},
                since,
                client,
                asyncio.Semaphore(3),
                lambda _html, title: title + ". " + "Documented details. " * 20,
            )

    result = asyncio.run(run())
    assert requested == ["/archive", "/email/1111111111111111"]
    assert len(result.items) == 1
    assert result.items[0]["published"] == datetime.combine(
        yesterday, datetime.min.time(), timezone.utc
    )


def test_alphasignal_archive_rejects_redirected_listing_and_skips_old_articles(monkeypatch) -> None:
    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    requested: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path == "/archive":
            return httpx.Response(
                200,
                text="""<section aria-label="October 2026"><ul><li>
              <a href="/email/7777777777777777"><span class="type-archive-date">Oct 31<span>Sat</span></span>
              <span class="type-newsletter-card-title">Old issue</span></a></li></ul></section>""",
            )
        return httpx.Response(200, text="unexpected article request")

    async def run_stale() -> archives.ArchiveResult:
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await archives.fetch_archive(
                {"archive": {"url": "https://alphasignal.ai/archive", "kind": "alphasignal"}},
                datetime(2026, 11, 1, tzinfo=timezone.utc),
                client,
                asyncio.Semaphore(3),
                lambda _html, title: title + ". Public body. " * 20,
            )

    stale = asyncio.run(run_stale())
    assert stale.items == []
    assert stale.errors == ["AlphaSignal archive appears stale; latest dated issue: 2026-10-31"]
    assert stale.dated == 0
    assert stale.listed == 1
    assert requested == ["https://alphasignal.ai/archive"]

    async def run_redirect() -> None:
        def redirect(request: httpx.Request) -> httpx.Response:
            requested.append(str(request.url))
            if request.url.host == "alphasignal.ai":
                return httpx.Response(
                    302, headers={"Location": "https://outside.example.org/archive"}
                )
            return httpx.Response(200, text="No AlphaSignal archive here")

        async with httpx.AsyncClient(transport=httpx.MockTransport(redirect)) as client:
            await archives.fetch_archive(
                {"archive": {"url": "https://alphasignal.ai/archive", "kind": "alphasignal"}},
                datetime.now(timezone.utc),
                client,
                asyncio.Semaphore(3),
                lambda _html, title: title + ". Public body. " * 20,
            )

    with pytest.raises(feeds.PublicFeedFetchError, match="approved listing URL"):
        asyncio.run(run_redirect())
    assert "https://outside.example.org/archive" in requested
    assert not any("/email/" in url for url in requested)


def test_alphasignal_archive_rejects_missing_date_or_title_binding() -> None:
    with pytest.raises(feeds.PublicFeedFetchError, match="no dated, supported"):
        archives.alphasignal_archive_cards(
            '<section aria-label="November 2026"><li><a href="/email/1111111111111111">No date/title</a></li></section>',
            "https://alphasignal.ai/archive",
        )


def test_alphasignal_recent_subscriber_only_page_fails_closed(monkeypatch) -> None:
    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    today = datetime.now(timezone.utc).date()
    date_label = today.strftime("%b %d %a")
    section_label = today.strftime("%B %Y")
    listing = f"""<section aria-label="{section_label}"><ul><li>
      <a href="/email/8888888888888888"><span class="type-archive-date">{date_label}</span>
      <span class="type-newsletter-card-title">Subscriber issue</span></a>
      </li></ul></section>"""

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/archive":
            return httpx.Response(200, text=listing)
        return httpx.Response(
            200,
            text='<meta property="og:title" content="Subscriber issue">'
            '<script type="application/ld+json">'
            '{"@type":"Article","isAccessibleForFree":false}</script>',
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await archives.fetch_archive(
                {"archive": {"url": "https://alphasignal.ai/archive", "kind": "alphasignal"}},
                datetime(today.year, today.month, today.day, tzinfo=timezone.utc),
                client,
                asyncio.Semaphore(3),
                lambda _html, title: title + ". Public body. " * 20,
            )

    result = asyncio.run(run())
    assert result.items == []
    assert result.dated == 0
    assert result.listed == 1
    assert result.errors == ["AlphaSignal issue is not declared publicly accessible"]
