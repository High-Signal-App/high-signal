"""YouTube transcripts adapter — technical, market, and founder/operator channels.

Pulls latest videos via the channel RSS (free, no key) and grabs transcripts via
`youtube-transcript-api` (free). No API quota issues.

Channel RSS pattern: https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Iterator

import feedparser
import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 youtube-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 4

# (channel_id, name, default_entity_id_or_None)
DEFAULT_CHANNELS: list[tuple[str, str, str | None]] = [
    ("UC1LpsuAUaKoMzzJSEt5WImw", "Asianometry", None),  # semis history + analysis
    ("UCv6J_jJa8GJqFwQNgNrMuww", "ServeTheHome", None),  # data center hardware
    ("UC1r0DG-KEPyqOeW6o79PByw", "TechTechPotato", None),  # Ian Cutress, semis deep dives
    ("UCIALMKvObZNtJ6AmdCLP7Lg", "Bloomberg Television", None),  # earnings + macro
    ("UCCJBSLNtozkO-NqjpPZujiQ", "TaiwanPlus News", "TSM"),  # Taiwan-side semis context
    ("UCknLrEdhRCp1aegoMqRaCZg", "DW News (English)", None),  # EU/Asia angle
    ("UCo7a6riBFJ3tkeHjvkXPn1g", "CNBC International TV", None),
    ("UCMliswJ7oukCeW35GSayhRA", "WSJ News", None),
    ("UCcefcZRL2oaA_uBNeo5UOWg", "Y Combinator", None),
    ("UC9cn0TuPq4dnbTY-CBsm8XA", "a16z", None),
    ("UCESLZhusAkFfsNsApnjF_Cg", "All-In Podcast", None),
    ("UC6t1O76G0jYXOAoYCm153dA", "Lenny's Podcast", None),
    ("UCPbwhExawYrn9xxI21TFfyw", "The Pragmatic Engineer", None),
    ("UCf0PBRjhf0rF8fWBIxTuoWA", "20VC with Harry Stebbings", None),
    ("UCxBcwypKK-W3GHd_RZ9FZrQ", "Latent Space", None),
]


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            return ""
        return r.text
    except httpx.HTTPError:
        return ""


def _fetch_transcript(video_id: str) -> str:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore

        items = YouTubeTranscriptApi.get_transcript(video_id, languages=["en"])
        return " ".join(it.get("text", "") for it in items)[:30_000]
    except Exception as exc:
        LOGGER.debug("transcript failed video=%s error=%s", video_id, exc)
        return ""


def _fallback_summary(entry: dict) -> str:
    summary = (entry.get("summary") or entry.get("description") or "").strip()
    return summary[:30_000] if len(summary) >= 300 else ""


async def fetch_channel_async(
    channel_id: str,
    name: str,
    entity_id: str | None,
    since: datetime,
    client: httpx.AsyncClient,
) -> list[Event]:
    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    xml = await _fetch_text(client, feed_url)
    if not xml:
        return []
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    for entry in parsed.entries[:8]:  # most-recent 8 videos
        link = entry.get("link", "")
        title = (entry.get("title") or "").strip()
        published = entry.get("published") or entry.get("updated") or ""
        try:
            pub = datetime.fromisoformat(published.replace("Z", "+00:00"))
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if pub < since:
            continue
        video_id = entry.get("yt_videoid") or link.split("v=")[-1].split("&")[0]
        # Transcript fetch is sync + can take 5-10s; offload to thread
        transcript = await asyncio.to_thread(_fetch_transcript, video_id)
        content = transcript or _fallback_summary(entry)
        if not content:
            # Skip if transcript and description are both missing — title alone is too thin.
            continue
        raw_hash = _hash("youtube", channel_id, video_id)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"youtube:{name}",
                source_url=link,
                published_at=pub,
                title=f"{name}: {title}",
                content=content,
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_all_async(
    days: int = 7,
    channels: list[tuple[str, str, str | None]] | None = None,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": USER_AGENT}
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        batches = await asyncio.gather(
            *(
                fetch_channel_async(cid, name, eid, since, client)
                for cid, name, eid in (channels or DEFAULT_CHANNELS)
            )
        )
    return [event for batch in batches for event in batch]


def fetch_all(
    days: int = 7, channels: list[tuple[str, str, str | None]] | None = None
) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, channels=channels))


def fetch_channel(
    channel_id: str, name: str, entity_id: str | None, days: int = 7
) -> Iterator[Event]:
    yield from fetch_all(days=days, channels=[(channel_id, name, entity_id)])
