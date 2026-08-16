"""Metaculus API adapter.

Requires ``METACULUS_TOKEN``. Metaculus forecasts are context and calibration
signals only; they should not be treated as primary evidence or new facts.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 metaculus-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://www.metaculus.com/api/posts/"


@dataclass(frozen=True)
class MetaculusQuery:
    search: str


QUERIES = [
    MetaculusQuery("artificial intelligence"),
    MetaculusQuery("semiconductor"),
    MetaculusQuery("data center"),
    MetaculusQuery("startup"),
]


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


def events_from_response(
    query: MetaculusQuery, payload: dict[str, Any], since: datetime
) -> list[Event]:
    rows = payload.get("results") if isinstance(payload.get("results"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        post_id = str(row.get("id") or "").strip()
        title = str(row.get("title") or row.get("short_title") or "").strip()
        published = _parse_datetime(str(row.get("published_at") or row.get("created_at") or ""))
        if not post_id or not title or published is None or published < since:
            continue
        question = row.get("question") if isinstance(row.get("question"), dict) else {}
        aggregate = (
            question.get("aggregations") if isinstance(question.get("aggregations"), dict) else {}
        )
        raw_hash = event_hash("metaculus", query.search, post_id)
        content = "\n".join(
            part
            for part in [
                f"Query: {query.search}",
                f"Status: {row.get('status')}" if row.get("status") else "",
                f"Close time: {row.get('scheduled_close_time')}"
                if row.get("scheduled_close_time")
                else "",
                f"Aggregations: {aggregate}" if aggregate else "",
            ]
            if part
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source="metaculus",
                source_url=f"https://www.metaculus.com/questions/{post_id}/",
                published_at=published,
                title=f"Metaculus forecast: {title}",
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 30, token: str | None = None) -> list[Event]:
    auth_token = token or os.environ.get("METACULUS_TOKEN")
    if not auth_token:
        LOGGER.debug("metaculus skipped: METACULUS_TOKEN is not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Authorization": f"Token {auth_token}",
        },
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for query in QUERIES:
            try:
                response = client.get(API_URL, params={"search": query.search, "limit": 20})
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("metaculus fetch failed query=%s error=%s", query.search, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(query, payload, since))
    return out
