from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import dedupe
from high_signal_ingest.types import Event
from high_signal_ingest.utils import source_family


def _ev(source: str, title: str, url: str, content: str = "", day: int = 20) -> Event:
    return Event(
        id=f"{source}:{title}"[:16],
        source=source,
        source_url=url,
        published_at=datetime(2026, 6, day, tzinfo=timezone.utc),
        title=title,
        content=content or None,
        primary_entity_id=None,
        raw_hash=f"{source}:{title}",
    )


def test_canonical_url_strips_tracking_keeps_id() -> None:
    # Tracking params dropped, host/scheme/fragment normalised.
    a = dedupe.canonical_url("https://www.Example.com/Article/?utm_source=x&fbclid=y#frag")
    b = dedupe.canonical_url("http://example.com/Article")
    assert a == b == "example.com/article"
    # But a meaningful query param (the record id) is KEPT — distinct ids must
    # not collapse (Legistar `?ID=`, `item?id=`).
    assert dedupe.canonical_url("https://x.legistar.com/D.aspx?ID=1") != dedupe.canonical_url(
        "https://x.legistar.com/D.aspx?ID=2"
    )


def test_merges_on_shared_external_url() -> None:
    # HN keeps the article URL in content; a news item links it directly.
    hn = _ev(
        "hackernews",
        "Show HN: NVIDIA thing",
        "https://news.ycombinator.com/item?id=1",
        content="Link: https://acme.com/nvidia-news",
    )
    news = _ev("news", "NVIDIA announces new chip", "https://acme.com/nvidia-news/")
    stories = dedupe.dedupe([hn, news])
    assert len(stories) == 1
    assert stories[0].distinct_sources == 2
    assert stories[0].representative.source == "news"  # higher authority rank


def test_merges_on_title_overlap_same_day() -> None:
    a = _ev("hackernews", "OpenAI launches GPT-6 model for enterprise", "https://h/1")
    b = _ev("techmeme", "OpenAI launches GPT-6 model for enterprise customers", "https://t/2")
    stories = dedupe.dedupe([a, b])
    assert len(stories) == 1
    assert stories[0].distinct_sources == 2


def test_does_not_merge_unrelated() -> None:
    a = _ev("hackernews", "A guide to sourdough bread baking", "https://h/1")
    b = _ev("reddit", "Quarterly cloud market share report", "https://r/2")
    stories = dedupe.dedupe([a, b])
    assert len(stories) == 2


def test_dedupe_events_returns_one_per_story() -> None:
    a = _ev("hackernews", "same story here now", "https://h/1", content="Link: https://x.com/a")
    b = _ev("reddit", "same story here now today", "https://r/2", content="Link: https://x.com/a")
    assert len(dedupe.dedupe_events([a, b])) == 1


def test_dedupe_exact_collapses_same_url_keeps_distinct() -> None:
    # Same article re-reported across two feeds (same canonical URL) -> collapse,
    # keeping the higher-authority representative.
    feed1 = _ev("gdelt", "Acme ships chip", "https://acme.com/news/")
    feed2 = _ev("news", "Acme ships chip", "https://acme.com/news?utm_source=x")
    # A genuinely different source/URL about the same topic -> KEPT (corroboration).
    other = _ev("courtlistener", "Acme antitrust suit", "https://courtlistener.com/o/9/")
    out = dedupe.dedupe_exact([feed1, feed2, other])
    assert len(out) == 2  # two feeds collapse to one; distinct URL preserved
    urls = {dedupe.external_url(e) for e in out}
    assert "acme.com/news" in urls and "courtlistener.com/o/9" in urls
    # representative of the collapsed pair is the higher-authority `news`
    rep = next(e for e in out if dedupe.external_url(e) == "acme.com/news")
    assert rep.source == "news"


def test_dedupe_exact_keeps_events_without_url() -> None:
    a = _ev("reddit", "discussion", "")
    b = _ev("reddit", "another", "")
    assert len(dedupe.dedupe_exact([a, b])) == 2


def test_story_counts_distinct_origins_not_feed_hosts() -> None:
    hn = _ev(
        "hackernews",
        "NVIDIA launches new accelerator platform",
        "https://news.ycombinator.com/item?id=1",
        content="Link: https://origin.example/announcement",
    )
    repeat = _ev(
        "techmeme",
        "NVIDIA launches new accelerator platform today",
        "https://techmeme.com/story/1",
        content="Link: https://origin.example/announcement?utm_source=repeat",
    )
    independent = _ev(
        "news",
        "NVIDIA launches new accelerator platform for customers",
        "https://independent.example/report",
    )

    [story] = dedupe.dedupe([hn, repeat, independent])
    assert story.distinct_sources == 3
    assert story.distinct_origins == 2


def test_source_family_collapses_edgar_underscore_variants() -> None:
    """EDGAR is the one adapter separating family from variant with `_`.

    `workers/api/src/routes/data.ts` already special-cases the prefix; the
    Python analysis layer must agree, otherwise `edgar_8k` and `edgar_10q` read
    as two *independent* sources for the same filer (over-counting
    `Story.distinct_sources`) and `_SOURCE_RANK["edgar"]` never applies.
    """
    assert source_family("edgar_8k") == "edgar"
    assert source_family("edgar_10q") == "edgar"
    assert source_family("edgar_d") == "edgar"
    # The `:` convention every other adapter uses is untouched.
    assert source_family("legistar:phoenix") == "legistar"
    assert source_family("macro-rates:fred:dgs10") == "macro-rates"
    assert source_family("sec-xbrl:nvda") == "sec-xbrl"
    # Not a false prefix match.
    assert source_family("edgartools") == "edgartools"


def test_two_edgar_forms_are_one_source_not_two() -> None:
    """Corroboration counting must not treat 8-K and 10-Q as independent."""
    a = _ev("edgar_8k", "NVDA 8-K: 2.02", "https://sec.gov/a")
    b = _ev("edgar_10q", "NVDA 10-Q", "https://sec.gov/b")
    story = dedupe.Story(representative=a, members=[a, b])
    assert story.distinct_sources == 1
    assert story.sources == ["edgar"]


def test_edgar_filing_outranks_a_news_rewrite() -> None:
    filing = _ev("edgar_8k", "NVDA 8-K: 2.02", "https://sec.gov/a")
    rewrite = _ev("gdelt", "NVDA 8-K: 2.02", "https://sec.gov/a")
    out = dedupe.dedupe_exact([rewrite, filing])
    assert len(out) == 1
    assert out[0].source == "edgar_8k"
