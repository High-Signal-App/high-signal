from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import dedupe
from high_signal_ingest.types import Event


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


def test_canonical_url_normalises() -> None:
    a = dedupe.canonical_url("https://www.Example.com/Article/?utm=x#frag")
    b = dedupe.canonical_url("http://example.com/Article")
    assert a == b == "example.com/article"


def test_merges_on_shared_external_url() -> None:
    # HN keeps the article URL in content; a news item links it directly.
    hn = _ev("hackernews", "Show HN: NVIDIA thing", "https://news.ycombinator.com/item?id=1",
             content="Link: https://acme.com/nvidia-news")
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
