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
    return _post_result(path, body) is not None


def _post_result(path: str, body: dict[str, Any]) -> dict[str, Any] | None:
    api = _api_base()
    tok = _token()
    if not api or not tok:
        return None
    try:
        r = httpx.post(
            f"{api.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            json=body,
            timeout=30.0,
        )
        if r.status_code >= 400:
            LOGGER.warning("audit %s failed: %s %s", path, r.status_code, r.text[:200])
            return None
        resp = r.json()
        if not isinstance(resp, dict):
            LOGGER.warning("audit %s: invalid acknowledgement", path)
            return None
        return resp
    except Exception as exc:
        LOGGER.warning("audit %s exception: %s", path, exc)
        return None


def new_run_id() -> str:
    return uuid.uuid4().hex[:16]


def fetch_related_evidence(title: str) -> dict[str, Any] | None:
    """Read-only corpus lookup; None distinguishes failure from empty evidence."""
    return _post_result("/admin/evidence/related", {"title": title})


def push_events(events: Iterable[Event], fetch_run_id: str | None) -> int:
    """Return server-acknowledged events, including already-stored duplicates.

    The API's legacy `inserted` counter counts successful upserts/no-ops, not
    distinct new rows. Missing or malformed acknowledgements prove no acceptance.
    """
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
        batch = payload[i : i + chunk]
        result = _post_result("/admin/events", {"events": batch})
        accepted = result.get("inserted") if result is not None else None
        if type(accepted) is not int or not 0 <= accepted <= len(batch):
            accepted = 0
            LOGGER.warning("push_events: invalid or missing batch acknowledgement")
        total += accepted
        if accepted < len(batch):
            LOGGER.warning(
                "push_events chunk %d/%d: %d/%d acknowledged (%d unacknowledged)",
                i // chunk + 1,
                (len(payload) + chunk - 1) // chunk,
                accepted,
                len(batch),
                len(batch) - accepted,
            )
    LOGGER.info("push_events: %d/%d events acknowledged", total, len(payload))
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


def push_ingest_runs(runs: list[dict[str, Any]]) -> bool:
    """Persist per-adapter receipts in one request for an `all` run."""
    if not runs:
        return True
    return _post("/admin/ingest-runs/bulk", {"runs": runs})
