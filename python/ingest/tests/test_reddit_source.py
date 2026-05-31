from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest.sources import reddit


@pytest.mark.asyncio
async def test_fetch_subreddit_falls_back_to_rss_on_403() -> None:
    rss = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>GitHub Copilot pricing backlash</title>
        <link href="https://www.reddit.com/r/LocalLLaMA/comments/example/post/" />
        <updated>2026-05-31T06:00:00+00:00</updated>
        <summary>Developers discuss cost predictability for AI coding tools.</summary>
      </entry>
    </feed>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/new.json"):
            return httpx.Response(403, text="blocked")
        return httpx.Response(200, text=rss)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)
    try:
        events = await reddit.fetch_subreddit_async(
            "LocalLLaMA",
            datetime(2026, 5, 31, tzinfo=timezone.utc),
            client,
        )
    finally:
        await client.aclose()

    assert len(events) == 1
    assert events[0].source == "reddit:LocalLLaMA"
    assert events[0].title == "GitHub Copilot pricing backlash"


@pytest.mark.asyncio
async def test_fetch_subreddit_json_uses_lower_score_floor() -> None:
    payload = {
        "data": {
            "children": [
                {
                    "data": {
                        "created_utc": 1_780_204_000,
                        "permalink": "/r/startups/comments/example/post/",
                        "title": "AI pricing makes budgets hard",
                        "selftext": "Teams need predictable usage controls.",
                        "score": 10,
                    }
                }
            ]
        }
    }
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _req: httpx.Response(200, json=payload)))
    try:
        events = await reddit.fetch_subreddit_async(
            "startups",
            datetime(2026, 5, 31, tzinfo=timezone.utc),
            client,
        )
    finally:
        await client.aclose()

    assert len(events) == 1
    assert events[0].title == "AI pricing makes budgets hard"
