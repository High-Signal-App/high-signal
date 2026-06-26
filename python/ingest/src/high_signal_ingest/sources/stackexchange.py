"""Stack Exchange adapter (Stack Overflow, free, key-less).

Developer Q&A volume is an adoption signal for the technology domain — which
tools/frameworks are drawing real implementation questions (rising) vs. going
quiet (declining). The Stack Exchange API is free and key-less (a low daily
quota, which our handful of tag queries stays well under).

We pull recent, upvoted questions on AI-infra / systems tags. These are
topic-mapped (tags name technologies, not tracked companies), so they feed the
technology domain thematically. No key required.
"""

from __future__ import annotations

import hashlib
import html
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event


USER_AGENT = "high-signal/0.1 stackexchange-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://api.stackexchange.com/2.3/questions"
SITE = "stackoverflow"
# Curation floor. Kept low: post-LLM, recent SO questions accrue votes slowly,
# so the signal here is thematic question *volume* per tag (technology adoption)
# rather than individual high-score posts.
MIN_SCORE = 1

# AI-infra / systems tags whose question volume tracks technology adoption.
TAGS: tuple[str, ...] = (
    "machine-learning",
    "pytorch",
    "tensorflow",
    "large-language-models",
    "langchain",
    "huggingface-transformers",
    "cuda",
    "kubernetes",
    "docker",
    "amazon-web-services",
    "google-cloud-platform",
    "azure",
    "apache-spark",
    "computer-vision",
    "nlp",
)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def events_from_response(tag: str, payload: dict[str, Any], since: datetime) -> list[Event]:
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    out: list[Event] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        qid = item.get("question_id")
        title = html.unescape(str(item.get("title") or "").strip())
        ts = item.get("creation_date")
        if qid is None or not title or not isinstance(ts, (int, float)):
            continue
        if int(item.get("score") or 0) < MIN_SCORE:
            continue
        published = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        if published < since:
            continue
        link = str(item.get("link") or f"https://stackoverflow.com/q/{qid}").strip()
        tags = item.get("tags") if isinstance(item.get("tags"), list) else []
        content = "\n".join(
            part
            for part in [
                f"Score: {item.get('score')} | Answers: {item.get('answer_count')} | Views: {item.get('view_count')}",
                f"Tags: {', '.join(str(t) for t in tags)}" if tags else f"Tag: {tag}",
                "",
                title,
            ]
            if part != ""
        )
        raw_hash = _hash("stackexchange", str(qid))
        out.append(
            Event(
                id=raw_hash[:16],
                source="stackexchange",
                source_url=link,
                published_at=published,
                title=f"Stack Overflow [{tag}]: {title}",
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_ts = int(since.timestamp())
    out: list[Event] = []
    seen: set[str] = set()
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for tag in TAGS:
            params = {
                "order": "desc",
                "sort": "votes",
                "site": SITE,
                "tagged": tag,
                "fromdate": since_ts,
                "pagesize": 30,
            }
            try:
                resp = client.get(API_URL, params=params)
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("stackexchange tag=%s failed: %s", tag, exc)
                continue
            if isinstance(payload, dict):
                for ev in events_from_response(tag, payload, since):
                    if ev.id not in seen:
                        seen.add(ev.id)
                        out.append(ev)
    return out
