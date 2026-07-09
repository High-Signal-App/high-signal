#!/usr/bin/env python3
"""Probe YouTube brand-awareness results with transcript availability.

Run from repo root:
    uv run --project python/ingest python scripts/youtube-brand-awareness-probe.py "Perplexity AI"

Discovery:
- Uses the official YouTube Data API when YOUTUBE_API_KEY is present.
- Falls back to local yt-dlp search when no key is available.

Transcript extraction uses the existing python/ingest youtube-transcript-api
dependency. This is an experiment/probe, not a production ingest path.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from typing import Any

import httpx
from youtube_transcript_api import YouTubeTranscriptApi


YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"


@dataclass
class VideoCandidate:
    video_id: str
    title: str
    channel: str
    views: int
    url: str


@dataclass
class ProbeResult:
    video_id: str
    title: str
    channel: str
    views: int
    url: str
    transcript_ok: bool
    transcript_chars: int
    title_mentions_brand: bool
    transcript_mentions_brand: bool
    excerpt: str
    error: str | None = None


def brand_terms(query: str) -> list[str]:
    stop = {"ai", "app", "inc", "the", "and", "for", "with"}
    terms = [term.lower() for term in re.findall(r"[A-Za-z0-9][A-Za-z0-9.+-]*", query)]
    return [term for term in terms if len(term) > 2 and term not in stop] or [query.lower()]


def mentions_any(text: str, terms: list[str]) -> bool:
    folded = text.lower()
    return any(term in folded for term in terms)


def excerpt_for(text: str, terms: list[str], max_len: int = 220) -> str:
    folded = text.lower()
    idx = -1
    for term in terms:
        idx = folded.find(term)
        if idx >= 0:
            break
    if idx < 0:
        excerpt = text[:max_len]
    else:
        start = max(0, idx - max_len // 3)
        excerpt = text[start : start + max_len]
    return " ".join(excerpt.split())


def discover_with_youtube_api(query: str, search_limit: int, min_views: int) -> list[VideoCandidate]:
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        return []

    search_params = {
        "key": api_key,
        "part": "snippet",
        "q": query,
        "type": "video",
        "order": "viewCount",
        "videoCaption": "closedCaption",
        "maxResults": min(max(search_limit, 1), 50),
    }
    search = httpx.get(YOUTUBE_SEARCH_URL, params=search_params, timeout=20.0)
    if search.is_error:
        raise RuntimeError(f"YouTube search failed: HTTP {search.status_code}")

    search_items = search.json().get("items", [])
    ids = [
        item.get("id", {}).get("videoId")
        for item in search_items
        if item.get("id", {}).get("videoId")
    ]
    if not ids:
        return []

    videos = httpx.get(
        YOUTUBE_VIDEOS_URL,
        params={
            "key": api_key,
            "part": "snippet,statistics",
            "id": ",".join(ids),
            "maxResults": len(ids),
        },
        timeout=20.0,
    )
    if videos.is_error:
        raise RuntimeError(f"YouTube videos lookup failed: HTTP {videos.status_code}")

    by_id: dict[str, dict[str, Any]] = {
        item.get("id", ""): item for item in videos.json().get("items", [])
    }
    out: list[VideoCandidate] = []
    for video_id in ids:
        item = by_id.get(video_id)
        if not item:
            continue
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        views = int(stats.get("viewCount") or 0)
        if views < min_views:
            continue
        out.append(
            VideoCandidate(
                video_id=video_id,
                title=snippet.get("title") or "",
                channel=snippet.get("channelTitle") or "",
                views=views,
                url=f"https://www.youtube.com/watch?v={video_id}",
            )
        )
    return out


def discover_with_ytdlp(query: str, search_limit: int, min_views: int) -> list[VideoCandidate]:
    if not shutil.which("yt-dlp"):
        raise RuntimeError("YOUTUBE_API_KEY is missing and yt-dlp is not installed")

    proc = subprocess.run(
        ["yt-dlp", "--no-warnings", "--dump-json", "--flat-playlist", f"ytsearch{search_limit}:{query}"],
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "yt-dlp search failed")

    out: list[VideoCandidate] = []
    seen: set[str] = set()
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        video_id = item.get("id") or ""
        if len(video_id) != 11 or video_id in seen:
            continue
        views = int(item.get("view_count") or 0)
        if views < min_views:
            continue
        seen.add(video_id)
        out.append(
            VideoCandidate(
                video_id=video_id,
                title=item.get("title") or "",
                channel=item.get("channel") or item.get("uploader") or "",
                views=views,
                url=f"https://www.youtube.com/watch?v={video_id}",
            )
        )
    return out


def fetch_transcript(video_id: str) -> str:
    api = YouTubeTranscriptApi()
    fetched = api.fetch(video_id, languages=["en"])
    return " ".join(snippet.text for snippet in fetched.snippets).replace("\n", " ")


def probe(
    query: str,
    min_views: int,
    search_limit: int,
    result_limit: int,
    skip_transcripts: bool = False,
) -> tuple[str, list[ProbeResult]]:
    source = "youtube-api" if os.environ.get("YOUTUBE_API_KEY") else "yt-dlp"
    candidates = discover_with_youtube_api(query, search_limit, min_views)
    if not candidates:
        candidates = discover_with_ytdlp(query, search_limit, min_views)
        source = "yt-dlp"

    terms = brand_terms(query)
    results: list[ProbeResult] = []
    for candidate in candidates[:result_limit]:
        if skip_transcripts:
            results.append(
                ProbeResult(
                    video_id=candidate.video_id,
                    title=candidate.title,
                    channel=candidate.channel,
                    views=candidate.views,
                    url=candidate.url,
                    transcript_ok=False,
                    transcript_chars=0,
                    title_mentions_brand=mentions_any(candidate.title, terms),
                    transcript_mentions_brand=False,
                    excerpt="",
                    error="Transcript fetch skipped",
                )
            )
            continue
        try:
            transcript = fetch_transcript(candidate.video_id)
            results.append(
                ProbeResult(
                    video_id=candidate.video_id,
                    title=candidate.title,
                    channel=candidate.channel,
                    views=candidate.views,
                    url=candidate.url,
                    transcript_ok=True,
                    transcript_chars=len(transcript),
                    title_mentions_brand=mentions_any(candidate.title, terms),
                    transcript_mentions_brand=mentions_any(transcript, terms),
                    excerpt=excerpt_for(transcript, terms),
                )
            )
        except Exception as exc:  # Transcript availability is source-dependent.
            results.append(
                ProbeResult(
                    video_id=candidate.video_id,
                    title=candidate.title,
                    channel=candidate.channel,
                    views=candidate.views,
                    url=candidate.url,
                    transcript_ok=False,
                    transcript_chars=0,
                    title_mentions_brand=mentions_any(candidate.title, terms),
                    transcript_mentions_brand=False,
                    excerpt="",
                    error=f"{type(exc).__name__}: {str(exc).splitlines()[0][:180]}",
                )
            )
    return source, results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Brand/query to search on YouTube")
    parser.add_argument("--min-views", type=int, default=10_000)
    parser.add_argument("--search-limit", type=int, default=20)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--skip-transcripts", action="store_true", help="Only fetch/rank video metadata")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of the summary view")
    args = parser.parse_args()

    source, results = probe(
        args.query,
        args.min_views,
        args.search_limit,
        args.limit,
        skip_transcripts=args.skip_transcripts,
    )

    if args.json:
        print(
            json.dumps(
                {
                    "query": args.query,
                    "source": source,
                    "min_views": args.min_views,
                    "results": [asdict(result) for result in results],
                },
                indent=2,
            )
        )
        return 0

    ok = sum(1 for result in results if result.transcript_ok)
    print(
        f"query={args.query!r} source={source} "
        f"candidates={len(results)} transcript_ok={ok} transcript_fail={len(results) - ok}"
    )
    for result in results:
        status = "OK" if result.transcript_ok else "FAIL"
        print(
            f"{status}\t{result.views}\t{result.channel}\t{result.title[:90]}\t{result.url}"
        )
        if result.transcript_ok:
            print(
                f"  transcript_chars={result.transcript_chars} "
                f"title_match={result.title_mentions_brand} "
                f"transcript_match={result.transcript_mentions_brand}"
            )
            if result.excerpt:
                print(f"  excerpt={result.excerpt}")
        elif result.error:
            print(f"  error={result.error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
