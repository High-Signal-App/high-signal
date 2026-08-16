"""GitHub releases adapter — semis tooling repos (CUDA, vLLM, llama.cpp, etc.).

Uses unauthenticated /releases endpoint (60 req/hr). Set GITHUB_TOKEN in env to
raise to 5000 req/hr.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Iterator

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 github-ingest"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 4

# (owner/repo, primary_entity_id) — entity_id may be null when the repo doesn't map cleanly
DEFAULT_REPOS: list[tuple[str, str | None]] = [
    ("NVIDIA/cutlass", "NVDA"),
    ("NVIDIA/TensorRT-LLM", "NVDA"),
    ("NVIDIA/Megatron-LM", "NVDA"),
    ("vllm-project/vllm", None),
    ("ggerganov/llama.cpp", None),
    ("pytorch/pytorch", None),
    ("triton-lang/triton", None),
    ("ROCm/ROCm", "AMD"),
    ("intel/intel-extension-for-pytorch", "INTC"),
    ("openai/triton", None),
    ("huggingface/transformers", None),
]


async def _fetch_releases(
    client: httpx.AsyncClient, repo: str, since: datetime, limit: int = 10
) -> list[dict]:
    url = f"https://api.github.com/repos/{repo}/releases?per_page={limit}"
    try:
        r = await client.get(url)
    except httpx.HTTPError as exc:
        LOGGER.debug("github fetch failed repo=%s error=%s", repo, exc)
        return []
    if r.status_code != 200:
        LOGGER.debug("github fetch failed repo=%s status=%s", repo, r.status_code)
        return []
    try:
        rels = r.json()
    except ValueError:
        return []
    out: list[dict] = []
    for rel in rels:
        published = rel.get("published_at") or rel.get("created_at")
        if not published:
            continue
        try:
            pub = datetime.fromisoformat(published.replace("Z", "+00:00"))
        except ValueError:
            continue
        if pub < since:
            continue
        out.append(
            {
                "tag": rel.get("tag_name") or rel.get("name") or "release",
                "html_url": rel.get("html_url") or "",
                "name": rel.get("name") or rel.get("tag_name") or "",
                "body": rel.get("body") or "",
                "published_at": pub,
                "prerelease": bool(rel.get("prerelease")),
            }
        )
    return out


async def fetch_repo_async(
    repo: str,
    entity_id: str | None,
    since: datetime,
    client: httpx.AsyncClient,
) -> list[Event]:
    rels = await _fetch_releases(client, repo, since)
    out: list[Event] = []
    for r in rels:
        if r["prerelease"]:
            continue
        url = r["html_url"]
        raw_hash = event_hash("github", repo, r["tag"])
        title = f"{repo} {r['tag']}: {r['name']}"
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"github:{repo}",
                source_url=url,
                published_at=r["published_at"],
                title=title,
                content=(r["body"] or "")[:20_000],
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_all_async(
    days: int = 7, repos: list[tuple[str, str | None]] | None = None
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        batches = await asyncio.gather(
            *(fetch_repo_async(repo, eid, since, client) for repo, eid in (repos or DEFAULT_REPOS))
        )
    return [event for batch in batches for event in batch]


def fetch_all(days: int = 7, repos: list[tuple[str, str | None]] | None = None) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, repos=repos))


def fetch_subreddit(*args, **kwargs) -> Iterator[Event]:  # placeholder for symmetry
    raise NotImplementedError
