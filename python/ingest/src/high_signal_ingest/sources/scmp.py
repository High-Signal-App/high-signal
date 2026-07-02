"""South China Morning Post RSS feeds focused on China tech and economy."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import news
from ..types import Event


FEEDS: tuple[dict[str, object], ...] = (
    {
        "id": "scmp-china-tech",
        "rss": "https://www.scmp.com/rss/320663/feed/",
        "topic_tags": ["china", "ai", "semiconductors", "internet", "startups"],
    },
    {
        "id": "scmp-china-economy",
        "rss": "https://www.scmp.com/rss/318421/feed/",
        "topic_tags": ["china", "economy", "trade", "policy", "capital-markets"],
    },
)


def _as_scmp_event(event: Event) -> Event:
    suffix = event.source.split(":", 1)[1] if ":" in event.source else event.source
    return event.model_copy(update={"source": f"scmp:{suffix}"})


def fetch_all(days: int = 3, fetch_body: bool = True) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    for feed in FEEDS:
        events = news.fetch_rss(feed, since=since, fetch_body=fetch_body)
        out.extend(_as_scmp_event(event) for event in events)
    return out
