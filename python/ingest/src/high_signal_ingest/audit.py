"""Audit / replay storage — pushes raw events, LLM calls, and ingest-run
summaries to /admin/* so we can debug 30 days from now without memory.

All POSTs are best-effort: log on failure, never break the pipeline.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx

from .types import Event


LOGGER = logging.getLogger(__name__)


def _api_base() -> str | None:
    return os.environ.get("API_BASE")


def _token() -> str | None:
    return os.environ.get("ADMIN_TOKEN")


def _enabled() -> bool:
    return bool(_api_base() and _token())


def _post(path: str, body: dict[str, Any]) -> bool:
    api = _api_base()
    tok = _token()
    if not api or not tok:
        return False
    try:
        r = httpx.post(
            f"{api.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            json=body,
            timeout=30.0,
        )
        if r.status_code >= 400:
            LOGGER.warning("audit %s failed: %s %s", path, r.status_code, r.text[:200])
            return False
        return True
    except Exception as exc:
        LOGGER.warning("audit %s exception: %s", path, exc)
        return False


def new_run_id() -> str:
    return uuid.uuid4().hex[:16]


def push_events(events: Iterable[Event], fetch_run_id: str | None) -> int:
    """Bulk-push raw events. Returns count attempted."""
    if not _enabled():
        return 0
    payload = [
        {
            "source": e.source,
            "sourceUrl": e.source_url,
            "publishedAt": e.published_at.isoformat(),
            "title": e.title,
            "content": e.content,
            "primaryEntityId": e.primary_entity_id,
            "rawHash": e.raw_hash,
            "fetchRunId": fetch_run_id,
            "sourceDocument": _source_document_payload(e),
        }
        for e in events
    ]
    if not payload:
        return 0
    # D1 batches — chunk to keep bodies small
    total = 0
    chunk = 50
    for i in range(0, len(payload), chunk):
        if _post("/admin/events", {"events": payload[i : i + chunk]}):
            total += len(payload[i : i + chunk])
    return total


def _source_document_payload(event: Event) -> dict[str, Any] | None:
    doc = event.source_document
    if doc is None:
        return None
    raw = doc.model_dump(mode="json", exclude_none=True)
    return {
        "canonicalUrl": raw.get("canonical_url"),
        "documentKey": raw.get("document_key"),
        "fetchedAt": raw.get("fetched_at"),
        "publishedAt": raw.get("published_at"),
        "rawHash": raw.get("raw_hash"),
        "rawText": raw.get("raw_text"),
        "rawJson": raw.get("raw_json"),
        "parsedFields": raw.get("parsed_fields"),
    }


def push_llm_run(
    *,
    signal_slug: str | None,
    model: str,
    prompt_version: str | None,
    accepted: bool,
    reason: str | None,
    request_json: dict,
    response_json: dict | None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
) -> bool:
    if not _enabled():
        return False
    return _post(
        "/admin/llm-runs",
        {
            "runs": [
                {
                    "signalSlug": signal_slug,
                    "model": model,
                    "promptVersion": prompt_version,
                    "accepted": accepted,
                    "reason": reason,
                    "requestJson": request_json,
                    "responseJson": response_json,
                    "tokensIn": tokens_in,
                    "tokensOut": tokens_out,
                    "latencyMs": latency_ms,
                }
            ]
        },
    )


def push_ingest_run(
    *,
    source: str,
    started_at: datetime,
    finished_at: datetime | None = None,
    days: int | None = None,
    events_fetched: int = 0,
    events_dropped_no_entity: int = 0,
    events_dropped_low_cluster: int = 0,
    signals_drafted: int = 0,
    errors: int = 0,
    error_sample: str | None = None,
    notes: str | None = None,
) -> bool:
    if not _enabled():
        return False
    return _post(
        "/admin/ingest-runs",
        {
            "source": source,
            "startedAt": started_at.isoformat(),
            "finishedAt": (finished_at or datetime.now(timezone.utc)).isoformat(),
            "days": days,
            "eventsFetched": events_fetched,
            "eventsDroppedNoEntity": events_dropped_no_entity,
            "eventsDroppedLowCluster": events_dropped_low_cluster,
            "signalsDrafted": signals_drafted,
            "errors": errors,
            "errorSample": error_sample,
            "notes": notes,
        },
    )
