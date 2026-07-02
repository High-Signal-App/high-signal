"""Broader China news RSS feeds for tech, startups, policy, and business."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import news
from ..types import Event


FEEDS: tuple[dict[str, object], ...] = (
    {
        "id": "technode",
        "rss": "https://technode.com/feed/",
        "topic_tags": ["china", "technology", "startups", "ai", "ev"],
    },
    {
        "id": "pandaily",
        "rss": "https://pandaily.com/feed/",
        "topic_tags": ["china", "technology", "startups", "ai", "ev"],
    },
    {
        "id": "cgtn-china",
        "rss": "https://www.cgtn.com/subscribe/rss/section/china.xml",
        "topic_tags": ["china", "policy", "macro", "society"],
    },
    {
        "id": "cgtn-business",
        "rss": "https://www.cgtn.com/subscribe/rss/section/business.xml",
        "topic_tags": ["china", "business", "economy", "markets"],
    },
)


def _as_china_news_event(event: Event) -> Event:
    suffix = event.source.split(":", 1)[1] if ":" in event.source else event.source
    return event.model_copy(update={"source": f"china-news:{suffix}"})


def fetch_all(days: int = 3, fetch_body: bool = True) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    for feed in FEEDS:
        events = news.fetch_rss(feed, since=since, fetch_body=fetch_body)
        out.extend(_as_china_news_event(event) for event in events)
    return out
