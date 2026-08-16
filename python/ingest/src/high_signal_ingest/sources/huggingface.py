"""Hugging Face Hub adapter.

Uses public Hub API endpoints for trending/recent models and datasets. This is
an adoption/distribution source for AI ecosystems, not a model-card mirror.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 huggingface-ingest"
LOGGER = logging.getLogger(__name__)
MODEL_URL = "https://huggingface.co/api/models"
DATASET_URL = "https://huggingface.co/api/datasets"

AUTHOR_ENTITY_MAP = {
    "anthropic": "ANTHROPIC",
    "databricks": "DATABRICKS",
    "huggingface": "HUGGINGFACE",
    "meta-llama": "META",
    "microsoft": "MSFT",
    "openai": "OPENAI",
}


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (
            parsed.astimezone(timezone.utc)
            if parsed.tzinfo
            else parsed.replace(tzinfo=timezone.utc)
        )
    except ValueError:
        return None


def _entity_for_repo(repo_id: str) -> str | None:
    author = repo_id.split("/", 1)[0].lower()
    return AUTHOR_ENTITY_MAP.get(author)


def events_from_items(kind: str, items: list[Any], since: datetime) -> list[Event]:
    out: list[Event] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        repo_id = str(item.get("modelId") or item.get("id") or "").strip()
        if not repo_id:
            continue
        published = _parse_datetime(str(item.get("lastModified") or item.get("createdAt") or ""))
        if published is None or published < since:
            continue
        downloads = item.get("downloads")
        likes = item.get("likes")
        tags = item.get("tags") if isinstance(item.get("tags"), list) else []
        content = "\n".join(
            part
            for part in [
                f"Downloads: {downloads}" if downloads is not None else "",
                f"Likes: {likes}" if likes is not None else "",
                f"Tags: {', '.join(str(tag) for tag in tags[:12])}" if tags else "",
            ]
            if part
        )
        raw_hash = event_hash("huggingface", kind, repo_id, published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"huggingface:{kind}",
                source_url=f"https://huggingface.co/{repo_id}",
                published_at=published,
                title=f"Hugging Face {kind}: {repo_id}",
                content=content or None,
                primary_entity_id=_entity_for_repo(repo_id) or "HUGGINGFACE",
                raw_hash=raw_hash,
            )
        )
    return out


def _fetch_items(client: httpx.Client, url: str, *, sort: str, limit: int) -> list[Any]:
    try:
        response = client.get(url, params={"sort": sort, "direction": -1, "limit": limit})
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("huggingface fetch failed url=%s error=%s", url, exc)
        return []
    return payload if isinstance(payload, list) else []


def fetch_all(days: int = 7, limit: int = 50) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        model_items = _fetch_items(client, MODEL_URL, sort="lastModified", limit=limit)
        dataset_items = _fetch_items(
            client, DATASET_URL, sort="lastModified", limit=max(10, limit // 2)
        )
    out.extend(events_from_items("model", model_items, since))
    out.extend(events_from_items("dataset", dataset_items, since))
    return out
