from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from high_signal_ingest.sources import reddit


def test_load_archive_events_preserves_attention_provenance(tmp_path: Path) -> None:
    path = tmp_path / "events.jsonl"
    row = {
        "schemaVersion": 1,
        "id": "abc123",
        "source": "reddit:technology",
        "sourceUrl": "https://www.reddit.com/r/technology/comments/abc/example/",
        "publishedAt": "2026-08-28T00:00:00.000Z",
        "retrievedAt": "2026-08-28T00:18:00.000Z",
        "title": "A material technology discussion",
        "content": "Operators describe the change.",
        "rawHash": "hash-abc",
        "sourceClass": "attention_aggregator",
        "evidenceTier": "derived",
        "confidenceContribution": "none",
        "attentionContribution": "allowed",
        "attention": {"score": 4, "commentCount": 24, "upvoteRatio": 0.91},
        "archive": {"schemaVersion": 2, "date": "2026-08-28", "postId": "abc"},
    }
    path.write_text(f"{json.dumps(row)}\n", encoding="utf-8")

    events = reddit.load_archive_events(path)

    assert len(events) == 1
    assert events[0].source == "reddit:technology"
    assert events[0].source_document is not None
    assert events[0].source_document.document_key == "reddit:abc"
    assert events[0].source_document.parsed_fields == {
        "source_class": "attention_aggregator",
        "evidence_tier": "derived",
        "confidence_contribution": "none",
        "attention_contribution": "allowed",
    }


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
async def test_fetch_subreddit_rss_returns_events() -> None:
    """RSS is the primary path (JSON is 403-blocked). Verify it parses."""
    rss_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<feed xmlns="http://www.w3.org/2005/Atom">'
        "<entry>"
        "<title>AI pricing makes budgets hard</title>"
        '<link href="https://www.reddit.com/r/startups/comments/example/post/" />'
        "<published>2026-06-15T12:00:00+00:00</published>"
        "<summary>Teams need predictable usage controls.</summary>"
        "</entry>"
        "</feed>"
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _req: httpx.Response(200, text=rss_xml)))
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
