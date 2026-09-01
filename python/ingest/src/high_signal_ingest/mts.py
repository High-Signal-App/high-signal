"""MTS Situations collector for the derived attention overlay.

Only compact ranking, entity/topic and source-reference metadata crosses the
High Signal API boundary. MTS descriptions, source-post text, avatars and raw
feed payloads are deliberately not retained. This module never emits an Event
directly; original publisher pages must pass the shared verification pipeline.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from .attention_cli import run_attention_collector
from .attention_verify import process_verification_requests
from .digg import canonicalize_url, payload_hash


FEED_KEY = "situations"
FEED_URL = "https://api.mts.now/situations"
CANONICAL_MTS_URL = "https://www.mts.now/situations"
MIN_REFRESH_SECONDS = 25 * 60
USER_AGENT = "high-signal/0.1 mts-attention"


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _compact_entities(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    entities: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        entities.append(
            {
                "name": name[:160],
                "type": str(item.get("type") or "unknown").strip()[:40],
            }
        )
    return entities[:24]


def _compact_topics(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    topics: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or "").strip()
        if not slug and not name:
            continue
        topics.append(
            {
                "slug": slug[:120],
                "name": name[:160],
                "confidence": _number(item.get("confidence")),
            }
        )
    return topics[:24]


def _compact_source_references(value: object) -> list[dict[str, str | None]]:
    if not isinstance(value, list):
        return []
    references: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        url = canonicalize_url(item.get("url"), base=CANONICAL_MTS_URL)
        if not url or url in seen:
            continue
        seen.add(url)
        references.append(
            {
                "url": url,
                "evidenceRole": str(item.get("evidenceRole") or "").strip()[:60] or None,
                "postedAt": str(item.get("postedAt") or "").strip()[:40] or None,
            }
        )
    return references[:50]


def _attention_metrics(value: object) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    allowed = (
        "velocity",
        "diversity",
        "source_breadth",
        "distinct_sources",
        "distinct_types",
        "evidence_quality",
        "total_likes",
    )
    return {key: number for key in allowed if (number := _number(value.get(key))) is not None}


def normalize_situation(
    story: dict[str, Any], position: int, retrieved_at: str
) -> dict[str, Any] | None:
    situation_id = str(story.get("id") or "").strip()
    title = str(story.get("name") or "").strip()
    if not situation_id or not title:
        return None
    source_references = _compact_source_references(story.get("sources"))
    metrics = _attention_metrics(story.get("rankBreakdown"))
    distinct_sources = max(
        len(source_references),
        int(metrics.get("distinct_sources", 0)),
    )
    return {
        "situationId": situation_id,
        "canonicalMtsUrl": CANONICAL_MTS_URL,
        "title": title[:500],
        "createdAt": story.get("createdAt"),
        "updatedAt": story.get("lastUpdatedAt"),
        "firstSeenAt": story.get("createdAt") or retrieved_at,
        "retrievedAt": retrieved_at,
        "position": position,
        "rankScore": _number(story.get("rankScore")),
        "criticality": str(story.get("criticality") or "").strip()[:40] or None,
        "lifecycle": str(story.get("lifecycle") or "").strip()[:40] or None,
        "eventType": str(story.get("eventType") or "").strip()[:80] or None,
        "genre": str(story.get("genre") or "").strip()[:80] or None,
        "confirmationInferred": bool(story.get("confirmationInferred")),
        "entities": _compact_entities(story.get("entities")),
        "topics": _compact_topics(story.get("topics")),
        "sourceReferences": source_references,
        "sourceUrls": [reference["url"] for reference in source_references],
        "distinctSourceCount": distinct_sources,
        "attentionMetrics": metrics,
        "payloadHash": payload_hash(story),
        "sourceClass": "attention_aggregator",
        "evidenceTier": "derived",
        "confidenceContribution": "none",
        "attentionContribution": "allowed",
    }


def normalize_feed(payload: dict[str, Any], retrieved_at: str) -> dict[str, Any]:
    stories = payload.get("stories")
    if not isinstance(stories, list):
        raise ValueError("unexpected MTS Situations payload")
    situations = [
        normalized
        for position, story in enumerate(stories, start=1)
        if isinstance(story, dict)
        and (normalized := normalize_situation(story, position, retrieved_at)) is not None
    ]
    return {
        "feedKey": FEED_KEY,
        "feedUrl": FEED_URL,
        "retrievedAt": retrieved_at,
        "payloadHash": payload_hash(payload),
        "itemCount": len(situations),
        "situations": situations,
    }


def is_due(client: httpx.Client, api_base: str, token: str) -> bool:
    response = client.get(
        f"{api_base.rstrip('/')}/admin/mts/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code == 404:
        return True
    response.raise_for_status()
    body = response.json()
    return isinstance(body, dict) and body.get("isDue") is True


def poll(api_base: str, token: str, *, now: datetime | None = None) -> dict[str, Any]:
    retrieved_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    with httpx.Client(headers=headers, timeout=30.0, follow_redirects=True) as client:
        if not is_due(client, api_base, token):
            return {"skipped": True, "reason": "minimum_refresh_interval", "feeds": 0}

        response = client.get(FEED_URL)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("unexpected MTS Situations payload")
        feed = normalize_feed(payload, retrieved_at)
        response = client.post(
            f"{api_base.rstrip('/')}/admin/mts",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"feed": feed},
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            return {"feeds": 1}

        return process_verification_requests(
            body,
            client,
            api_base=api_base,
            token=token,
            route="mts",
            attention_source="mts",
        )


def main() -> None:
    run_attention_collector("Poll the public MTS Situations feed", poll)


if __name__ == "__main__":
    main()
