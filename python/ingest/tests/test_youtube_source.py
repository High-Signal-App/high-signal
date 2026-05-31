from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest.sources import youtube


@pytest.mark.asyncio
async def test_fetch_channel_uses_description_when_transcript_missing(monkeypatch) -> None:
    summary = "Developer agents are shifting from hand-held coding to background work. " * 8
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <entry>
        <yt:videoId>abc123</yt:videoId>
        <title>Background agents in coding</title>
        <link href="https://www.youtube.com/watch?v=abc123" />
        <published>2026-05-31T06:00:00+00:00</published>
        <updated>2026-05-31T06:00:00+00:00</updated>
        <summary>{summary}</summary>
      </entry>
    </feed>
    """
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda _video_id: "")
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _req: httpx.Response(200, text=xml)))
    try:
        events = await youtube.fetch_channel_async(
            "channel",
            "Latent Space",
            None,
            datetime(2026, 5, 31, tzinfo=timezone.utc),
            client,
        )
    finally:
        await client.aclose()

    assert len(events) == 1
    assert events[0].title == "Latent Space: Background agents in coding"
    assert events[0].content and "Developer agents" in events[0].content
