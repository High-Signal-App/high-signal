"""Bounded, preview-first replay of existing public news article receipts.

Only explicit source-document receipts change. The original event observation
and its identity are replayed unchanged through the normal audited ingest API.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import urllib.parse
from datetime import UTC, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import httpx

from . import audit
from .sources import news, registered_feeds
from .types import Event, SourceDocument
from .utils import event_hash


def event_ids(value: str) -> list[str]:
    ids = [item.strip() for item in value.split(",")]
    if not 1 <= len(ids) <= 2 or len(set(ids)) != len(ids):
        raise argparse.ArgumentTypeError("Provide one or two distinct event IDs")
    if any(not re.fullmatch(r"[a-f0-9]{16}", item) for item in ids):
        raise argparse.ArgumentTypeError("Event IDs must be 16 lowercase hexadecimal characters")
    return ids


def original_event_hash(record: dict) -> str:
    if not record.get("available") or not str(record.get("source", "")).startswith("news:"):
        raise ValueError("Only available public news records may be replayed")
    if not isinstance(record.get("content"), str) or record.get("retainedTextTruncated"):
        raise ValueError("A complete original public record is required")
    candidates = {
        event_hash(record["source"].removeprefix("news:"), record["url"]),
        hashlib.sha256(record["content"].encode()).hexdigest(),
    }
    matches = [
        raw for raw in candidates if hashlib.sha256(raw.encode()).hexdigest()[:16] == record["id"]
    ]
    if len(matches) != 1:
        raise ValueError("The existing news event identity could not be verified")
    return matches[0]


async def public_record(client: httpx.AsyncClient, api_base: str, event_id: str) -> dict:
    document = await registered_feeds.fetch_public_document(
        client, f"{api_base.rstrip('/')}/data/records/{event_id}", max_bytes=256 * 1024
    )
    record = json.loads(document.text)
    if not isinstance(record, dict) or record.get("id") != event_id:
        raise ValueError("Public record response identity mismatch")
    return record


async def prepare_repairs(ids: list[str], api_base: str, client: httpx.AsyncClient) -> list[Event]:
    events: list[Event] = []
    for event_id in ids:
        record = await public_record(client, api_base, event_id)
        raw_hash = original_event_hash(record)
        title = record.get("title")
        if not isinstance(title, str) or not title or type(record.get("publishedAt")) is not int:
            raise ValueError("An original title and publication date are required")
        document = await registered_feeds.fetch_public_document(client, record["url"])
        body = await asyncio.to_thread(news._extract_article_text, document.text, title)
        published = datetime.fromtimestamp(record["publishedAt"], tz=timezone.utc)
        receipt = news._article_receipt(
            body, title, record.get("canonicalUrl") or record["url"], published
        )
        if receipt is None:
            raise ValueError(f"No substantive aligned public article for {event_id}")
        receipt.fetched_at = datetime.now(timezone.utc)
        receipt.raw_json = {"previousPublicRecord": record}
        receipt.parsed_fields = {
            **(receipt.parsed_fields or {}),
            "receiptRepairEventId": event_id,
            "retrievedUrl": document.url,
            "previousDocumentFetchedAt": record.get("documentFetchedAt"),
        }
        events.append(
            Event(
                id=event_id,
                source=record["source"],
                source_url=record["url"],
                published_at=published,
                title=title,
                content=record["content"],
                primary_entity_id=record.get("entity"),
                raw_hash=raw_hash,
                source_document=receipt,
            )
        )
    return events


MAX_PREPARED_BYTES = 60_000
MAX_METADATA_PREVIEW_BYTES = 60_000


class _PublishedDateMetadata(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_json_ld = False
        self.chunks: list[str] = []
        self.dates: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "script" and (values.get("type") or "").lower() == "application/ld+json":
            self.in_json_ld = True
            self.chunks = []
        if (
            tag == "meta"
            and values.get("property", "").lower() == "article:published_time"
            and values.get("content")
        ):
            self.dates.append(values["content"] or "")
        if (
            tag == "time"
            and values.get("itemprop", "").lower() == "datepublished"
            and values.get("datetime")
        ):
            self.dates.append(values["datetime"] or "")

    def handle_data(self, data: str) -> None:
        if self.in_json_ld:
            self.chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "script" or not self.in_json_ld:
            return
        try:
            self.dates.extend(_published_dates(json.loads("".join(self.chunks))))
        except (ValueError, RecursionError):
            pass
        self.in_json_ld = False
        self.chunks = []


def _published_dates(value: object) -> list[str]:
    found: list[str] = []
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            date = item.get("datePublished")
            if isinstance(date, str):
                found.append(date)
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return found


def _verified_page_publication(html: str, published: datetime) -> list[str]:
    metadata = _PublishedDateMetadata()
    metadata.feed(html)
    matches = []
    for raw in metadata.dates:
        try:
            value = datetime.fromisoformat(raw)
        except (TypeError, ValueError, OverflowError):
            continue
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        value = value.astimezone(UTC)
        if value.date() == published.date():
            matches.append(value.isoformat())
    if not matches:
        raise ValueError("The fetched public page did not confirm the original publication date")
    return sorted(set(matches))


def _require_admin_target(api_base: str) -> str:
    configured = audit._api_base()
    if not audit._enabled() or not configured:
        raise ValueError("Existing authenticated admin access is required for receipt recovery")
    if configured.rstrip("/") != api_base.rstrip("/"):
        raise ValueError("Authenticated recovery must target the configured API")
    return configured.rstrip("/")


def _same_publisher(left: str, right: str) -> bool:
    try:
        a = urllib.parse.urlsplit(left)
        b = urllib.parse.urlsplit(right)

        def host(value):
            return (value.hostname or "").lower().removeprefix("www.")

        return (
            a.scheme == b.scheme == "https"
            and not a.username
            and not a.password
            and not b.username
            and not b.password
            and bool(host(a))
            and host(a) == host(b)
        )
    except ValueError:
        return False


def _state_fingerprint(state: dict) -> str:
    encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _load_metadata_preview(path: Path, event_id: str) -> dict:
    with path.open("rb") as stream:
        encoded = stream.read(MAX_METADATA_PREVIEW_BYTES + 1)
    if len(encoded) > MAX_METADATA_PREVIEW_BYTES:
        raise ValueError("Metadata recovery preview exceeds its 60000-byte limit")
    return _validate_metadata_preview(json.loads(encoded), event_id)


def validate_metadata_dispatch_input(mode: str, ids_value: str, preview_json: str) -> dict:
    if mode not in {"metadata-only-apply", "metadata-only-rollback"}:
        raise ValueError("Unsupported metadata-only repair mode")
    ids = event_ids(ids_value)
    if len(ids) != 1 or not preview_json:
        raise ValueError("Metadata-only repair requires one event ID and a saved preview")
    encoded = preview_json.encode()
    if len(encoded) > MAX_METADATA_PREVIEW_BYTES:
        raise ValueError("Metadata recovery preview exceeds its 60000-byte limit")
    item = _validate_metadata_preview(json.loads(encoded), ids[0])
    if mode == "metadata-only-apply" and (
        item["applied"] or item["applyPlan"] != _recovery_plan(item["recovery"])
    ):
        raise ValueError("Apply requires an unapplied, reviewed preview with a valid recovery plan")
    if mode == "metadata-only-rollback" and item["applyPlan"] != _recovery_plan(item["recovery"]):
        raise ValueError("Rollback requires a reviewed preview with a valid recovery plan")
    return item


def _validate_metadata_preview(item: dict, event_id: str) -> dict:
    if not isinstance(item, dict) or set(item) != {
        "recovery",
        "applyPlan",
        "appliedFingerprint",
        "applied",
        "rollbackFingerprint",
    }:
        raise ValueError("Metadata recovery preview has unexpected fields")
    recovery = item["recovery"]
    recovery_keys = {
        "eventId",
        "source",
        "sourceUrl",
        "title",
        "publishedAt",
        "pagePublicationDates",
        "retrievedUrl",
        "articleChars",
        "articleHash",
        "alignedToTitle",
        "originalRawHash",
        "before",
        "beforeFingerprint",
        "after",
    }
    if (
        not isinstance(recovery, dict)
        or set(recovery) != recovery_keys
        or recovery.get("eventId") != event_id
    ):
        raise ValueError("Metadata recovery preview does not match the explicit event ID")
    if not isinstance(item["applied"], bool):
        raise TypeError("Metadata recovery preview status is invalid")
    if not isinstance(item["applyPlan"], dict):
        raise ValueError("Metadata recovery preview plan is invalid")
    return item


def _saved_recovery_parts(item: dict) -> dict:
    recovery = item.get("recovery")
    before = recovery.get("before") if isinstance(recovery, dict) else None
    after = recovery.get("after") if isinstance(recovery, dict) else None
    if not isinstance(before, dict) or set(before) != {"event", "document"}:
        raise ValueError("Saved recovery preimage or article receipt is invalid")
    if not isinstance(after, dict):
        raise ValueError("Saved recovery preimage or article receipt is invalid")
    event = before["event"]
    document = before["document"]
    if not isinstance(event, dict) or not isinstance(document, dict):
        raise TypeError("Saved recovery state is malformed")
    if set(event) != {
        "id",
        "source",
        "sourceUrl",
        "title",
        "content",
        "publishedAt",
        "primaryEntityId",
        "rawHash",
        "fetchRunId",
        "sourceDocumentId",
    }:
        raise ValueError("Saved event snapshot has unexpected fields")
    if set(document) != {
        "id",
        "source",
        "canonicalUrl",
        "documentKey",
        "fetchedAt",
        "publishedAt",
        "rawHash",
        "rawText",
        "rawJson",
        "parsedFields",
    }:
        raise ValueError("Saved document snapshot has unexpected fields")
    if set(after) != {"fetchedAt", "rawHash", "rawText", "rawJson", "parsedFields"}:
        raise ValueError("Saved article receipt has unexpected fields")
    return {
        "recovery": recovery,
        "before": before,
        "after": after,
        "event": event,
        "document": document,
        "body": after.get("rawText"),
        "body_hash": after.get("rawHash"),
    }


def _recovery_public_metadata(recovery: dict) -> tuple[str, str, str, datetime]:
    source = recovery.get("source")
    source_url = recovery.get("sourceUrl")
    title = recovery.get("title")
    if not isinstance(source, str) or not source.startswith("news:"):
        raise ValueError("Saved recovery event metadata is malformed")
    if not isinstance(source_url, str) or not isinstance(title, str):
        raise ValueError("Saved recovery event metadata is malformed")
    return source, source_url, title, _prepared_time(recovery.get("publishedAt"))


def _validate_saved_article_provenance(
    recovery: dict, document: dict, event: dict, after: dict, body_hash: object
) -> None:
    parsed_fields = json.loads(after.get("parsedFields", "{}"))
    raw_json = json.loads(after.get("rawJson", "{}"))
    audit_snapshot = raw_json.get("receiptRecovery") if isinstance(raw_json, dict) else None
    if not isinstance(parsed_fields, dict) or not isinstance(audit_snapshot, dict):
        raise ValueError("Saved article provenance does not match its audited preimage")
    parsed_matches = (
        parsed_fields.get("documentKind") == "news_article"
        and parsed_fields.get("retrievedFrom") == "public_article_page"
        and parsed_fields.get("receiptRecoveryEventId") == event.get("id")
        and parsed_fields.get("retrievedUrl") == recovery.get("retrievedUrl")
        and parsed_fields.get("publicationDates") == recovery.get("pagePublicationDates")
    )
    audit_matches = (
        audit_snapshot.get("originalDocument") == document
        and audit_snapshot.get("retrievedUrl") == recovery.get("retrievedUrl")
        and audit_snapshot.get("bodyHash") == body_hash
        and audit_snapshot.get("bodyChars") == recovery.get("articleChars")
        and audit_snapshot.get("publicationDates") == recovery.get("pagePublicationDates")
    )
    if not parsed_matches or not audit_matches:
        raise ValueError("Saved article provenance does not match its audited preimage")


def _validate_saved_original_event(
    recovery: dict, event: dict, source: str, source_url: str, title: str, published: datetime
) -> None:
    original_hash = event_hash(source.removeprefix("news:"), source_url)
    identity_matches = (
        event.get("id") == recovery.get("eventId")
        and event.get("rawHash") == recovery.get("originalRawHash") == original_hash
        and hashlib.sha256(original_hash.encode()).hexdigest()[:16] == event.get("id")
    )
    metadata_matches = (
        event.get("source") == source
        and event.get("sourceUrl") == source_url
        and event.get("title") == title
        and event.get("content") is None
        and event.get("publishedAt") == int(published.timestamp())
    )
    if not identity_matches or not metadata_matches:
        raise ValueError("Saved recovery preview failed its original event checks")


def _validate_saved_original_document(
    recovery: dict, before: dict, event: dict, document: dict, body: object, body_hash: object
) -> None:
    event_metadata_matches = (
        document.get("publishedAt") == event.get("publishedAt")
        and document.get("source") == event.get("source")
        and document.get("canonicalUrl") is not None
        and document.get("parsedFields") is not None
    )
    original_is_metadata_only = document.get("rawText") is None and document.get("rawJson") is None
    body_is_valid = (
        isinstance(body, str)
        and 500 <= len(body) <= 30_000
        and isinstance(body_hash, str)
        and hashlib.sha256(body.encode()).hexdigest() == body_hash
        and recovery.get("articleHash") == body_hash
        and recovery.get("articleChars") == len(body)
    )
    publisher_matches = _same_publisher(
        recovery.get("retrievedUrl", ""), recovery["sourceUrl"]
    ) and _same_publisher(recovery.get("retrievedUrl", ""), document.get("canonicalUrl", ""))
    if (
        not event_metadata_matches
        or not original_is_metadata_only
        or not body_is_valid
        or not publisher_matches
        or _state_fingerprint(before) != recovery.get("beforeFingerprint")
    ):
        raise ValueError("Saved recovery preview failed its publisher, body, or preimage checks")


def _verify_recovery_snapshot(
    item: dict, recovery: dict, before: dict, snapshot: dict, *, applied: bool
) -> None:
    plan = item.get("applyPlan")
    if not isinstance(plan, dict) or plan != _recovery_plan(recovery):
        raise ValueError("Saved recovery plan does not match its reviewed preview")
    expected_fingerprint = (
        plan["expectedAfterFingerprint"] if applied else recovery.get("beforeFingerprint")
    )
    if applied and item.get("appliedFingerprint") not in (
        None,
        plan["expectedAfterFingerprint"],
    ):
        raise ValueError("Saved applied fingerprint differs from the recovery plan")
    if snapshot.get("fingerprint") != expected_fingerprint:
        raise ValueError("Current source receipt differs from the reviewed recovery preview")
    if not applied and snapshot.get("state") != before:
        raise ValueError(
            "Current source receipt preimage differs from the reviewed recovery preview"
        )
    if applied:
        expected_document = dict(before["document"])
        expected_document.update(recovery["after"])
        expected_document.update({"rawText": None, "rawJson": None, "parsedFields": None})
        expected_state = {"event": before["event"], "document": expected_document}
        receipt = snapshot.get("receipt")
        receipt_matches = (
            isinstance(receipt, dict)
            and receipt.get("bodyHash") == plan["bodyHash"]
            and receipt.get("bodyChars") == plan["bodyChars"]
            and receipt.get("applied") is True
        )
        if snapshot.get("state") != expected_state or not receipt_matches:
            raise ValueError("Current applied receipt differs from the recovery plan")


async def _verify_current_public_article(
    recovery: dict, event: dict, body_hash: str, api_base: str, client: httpx.AsyncClient
) -> None:
    record = await public_record(client, api_base, recovery["eventId"])
    record_matches = (
        record.get("available")
        and record.get("source") == recovery["source"]
        and record.get("url") == recovery["sourceUrl"]
        and record.get("title") == recovery["title"]
        and record.get("publishedAt") == event.get("publishedAt")
        and record.get("content") is None
        and record.get("retainedText") is None
    )
    if not record_matches:
        raise ValueError("Current public event metadata differs from the reviewed preview")
    page = await registered_feeds.fetch_public_document(client, recovery["sourceUrl"])
    if page.truncated or page.url != recovery["retrievedUrl"]:
        raise ValueError("Publisher URL or bounded page response differs from the reviewed preview")
    published = datetime.fromtimestamp(record["publishedAt"], tz=UTC)
    dates = _verified_page_publication(page.text, published)
    extracted = await asyncio.to_thread(news._extract_article_text, page.text, recovery["title"])
    receipt = news._article_receipt(
        extracted, recovery["title"], record.get("canonicalUrl") or record["url"], published
    )
    if receipt is None or hashlib.sha256(receipt.raw_text.encode()).hexdigest() != body_hash:
        raise ValueError("Publisher article body no longer matches the reviewed body hash")
    if dates != recovery.get("pagePublicationDates"):
        raise ValueError("Publisher page date evidence differs from the reviewed preview")


async def _verify_saved_recovery(
    item: dict, api_base: str, client: httpx.AsyncClient, *, applied: bool = False
) -> tuple[dict, dict]:
    parts = _saved_recovery_parts(item)
    recovery = parts["recovery"]
    before = parts["before"]
    event = parts["event"]
    document = parts["document"]
    after = parts["after"]
    body = parts["body"]
    body_hash = parts["body_hash"]
    source, source_url, title, published = _recovery_public_metadata(recovery)
    _validate_saved_article_provenance(recovery, document, event, after, body_hash)
    _validate_saved_original_event(recovery, event, source, source_url, title, published)
    _validate_saved_original_document(recovery, before, event, document, body, body_hash)
    snapshot = await _admin_snapshot(client, api_base, recovery["eventId"])
    _verify_recovery_snapshot(item, recovery, before, snapshot, applied=applied)
    if not applied:
        await _verify_current_public_article(recovery, event, body_hash, api_base, client)
    return snapshot, recovery


def _recovery_plan(recovery: dict) -> dict:
    before = recovery["before"]
    document = dict(before["document"])
    document.update(recovery["after"])
    after_state = {"event": before["event"], "document": document}
    return {
        "eventId": recovery["eventId"],
        "sourceUrl": recovery["sourceUrl"],
        "publishedAt": recovery["publishedAt"],
        "bodyHash": recovery["articleHash"],
        "bodyChars": recovery["articleChars"],
        "beforeFingerprint": recovery["beforeFingerprint"],
        "expectedAfterFingerprint": _state_fingerprint(after_state),
    }


async def rollback_metadata_recovery(item: dict, api_base: str, client: httpx.AsyncClient) -> dict:
    recovery = item["recovery"]
    plan = item.get("applyPlan")
    if not isinstance(plan, dict) or plan != _recovery_plan(recovery):
        raise ValueError("Rollback preview has no valid precomputed recovery plan")
    await _verify_saved_recovery(item, api_base, client, applied=True)
    response = await post_admin_json(
        client,
        api_base,
        f"/admin/news-receipts/{recovery['eventId']}/rollback",
        {
            "before": recovery["before"],
            "afterFingerprint": plan["expectedAfterFingerprint"],
        },
    )
    if response.get("fingerprint") != plan["beforeFingerprint"]:
        raise ValueError("Rollback response did not restore the reviewed preimage")
    item["applied"] = False
    item["appliedFingerprint"] = None
    item["rollbackFingerprint"] = response.get("fingerprint")
    return response


async def _admin_snapshot(client: httpx.AsyncClient, api_base: str, event_id: str) -> dict:
    _require_admin_target(api_base)
    token = audit._token()
    response = await client.get(
        f"{api_base.rstrip('/')}/admin/news-receipts/{event_id}",
        headers={"Authorization": f"Bearer {token}"},
        follow_redirects=False,
    )
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict) or not isinstance(value.get("state"), dict):
        raise TypeError("Admin receipt snapshot is invalid")
    return value


def _validate_metadata_only_record(record: dict, event_id: str) -> tuple[str, datetime]:
    valid_record = (
        record.get("available")
        and isinstance(record.get("source"), str)
        and record["source"].startswith("news:")
        and record.get("content") is None
        and record.get("retainedText") is None
        and not record.get("retainedTextTruncated")
    )
    if not valid_record:
        raise ValueError("Only a public metadata-only news event can use this recovery")
    if not isinstance(record.get("title"), str) or type(record.get("publishedAt")) is not int:
        raise ValueError("Original title and publication date are required")
    raw_hash = event_hash(record["source"].removeprefix("news:"), record["url"])
    if hashlib.sha256(raw_hash.encode()).hexdigest()[:16] != event_id:
        raise ValueError("The original public event identity could not be verified")
    return raw_hash, datetime.fromtimestamp(record["publishedAt"], tz=UTC)


def _validate_original_metadata_snapshot(
    record: dict, event_id: str, raw_hash: str, snapshot: dict
) -> tuple[dict, dict, dict]:
    state = snapshot["state"]
    event = state.get("event", {})
    document = state.get("document", {})
    event_matches = (
        event.get("id") == event_id
        and event.get("source") == record["source"]
        and event.get("sourceUrl") == record["url"]
        and event.get("title") == record["title"]
        and event.get("content") is None
        and event.get("publishedAt") == record["publishedAt"]
        and event.get("rawHash") == raw_hash
    )
    document_matches = (
        document.get("rawText") is None
        and document.get("rawJson") is None
        and document.get("canonicalUrl") == (record.get("canonicalUrl") or record["url"])
        and document.get("source") == record["source"]
    )
    if not event_matches or not document_matches:
        raise ValueError("Current event or metadata-only receipt differs from the public record")
    return state, event, document


async def prepare_metadata_recovery(
    event_id: str, api_base: str, client: httpx.AsyncClient
) -> dict:
    record = await public_record(client, api_base, event_id)
    raw_hash, published = _validate_metadata_only_record(record, event_id)
    snapshot = await _admin_snapshot(client, api_base, event_id)
    state, _event, document_state = _validate_original_metadata_snapshot(
        record, event_id, raw_hash, snapshot
    )
    document = await registered_feeds.fetch_public_document(client, record["url"])
    if document.truncated:
        raise ValueError("Publisher page exceeded the bounded public fetch limit")
    page_dates = _verified_page_publication(document.text, published)
    body = await asyncio.to_thread(news._extract_article_text, document.text, record["title"])
    receipt = news._article_receipt(
        body, record["title"], record.get("canonicalUrl") or record["url"], published
    )
    if receipt is None:
        raise ValueError("No substantive aligned public article for metadata-only event")
    receipt.fetched_at = datetime.now(UTC)
    body_hash = hashlib.sha256(receipt.raw_text.encode()).hexdigest()
    before_document = document_state
    audit_snapshot = {
        "originalDocument": before_document,
        "retrievedUrl": document.url,
        "publicationDates": page_dates,
        "bodyHash": body_hash,
        "bodyChars": len(receipt.raw_text),
    }
    return {
        "eventId": event_id,
        "source": record["source"],
        "sourceUrl": record["url"],
        "title": record["title"],
        "publishedAt": published.isoformat(),
        "pagePublicationDates": page_dates,
        "retrievedUrl": document.url,
        "articleChars": len(receipt.raw_text),
        "articleHash": body_hash,
        "alignedToTitle": news.article_text_is_aligned(receipt.raw_text, record["title"]),
        "originalRawHash": raw_hash,
        "before": state,
        "beforeFingerprint": snapshot.get("fingerprint"),
        "after": {
            "fetchedAt": int(receipt.fetched_at.timestamp()),
            "rawHash": body_hash,
            "rawText": receipt.raw_text,
            "rawJson": json.dumps({"receiptRecovery": audit_snapshot}, sort_keys=True),
            "parsedFields": json.dumps(
                {
                    "documentKind": "news_article",
                    "retrievedFrom": "public_article_page",
                    "receiptRecoveryEventId": event_id,
                    "retrievedUrl": document.url,
                    "publicationDates": page_dates,
                },
                sort_keys=True,
            ),
        },
    }


async def post_admin_json(client: httpx.AsyncClient, api_base: str, path: str, body: dict) -> dict:
    _require_admin_target(api_base)
    token = audit._token()
    response = await client.post(
        f"{api_base.rstrip('/')}{path}",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
        follow_redirects=False,
    )
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise TypeError("Admin receipt recovery response is invalid")
    return value


def _prepared_object(value: object, keys: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("Prepared replay has unexpected fields")
    return value


def _prepared_time(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Prepared receipt date is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Prepared receipt date must include a timezone")
    return parsed.astimezone(timezone.utc)


def _prepared_provenance(document: dict, record: dict) -> dict:
    fields = _prepared_object(
        document["parsedFields"],
        {
            "documentKind",
            "retrievedFrom",
            "receiptRepairEventId",
            "retrievedUrl",
            "previousDocumentFetchedAt",
        },
    )
    expected = {
        "documentKind": "news_article",
        "retrievedFrom": "public_article_page",
        "receiptRepairEventId": record["id"],
        "previousDocumentFetchedAt": record.get("documentFetchedAt"),
    }
    if any(fields[key] != value for key, value in expected.items()):
        raise ValueError("Prepared receipt provenance mismatch")
    registered_feeds.public_url(fields["retrievedUrl"])
    if document["rawJson"] != {"previousPublicRecord": record}:
        raise ValueError("Prepared receipt audit snapshot is stale or mismatched")
    return fields


def _prepared_receipt(document: object, record: dict, published: datetime) -> SourceDocument:
    fields = _prepared_object(
        document,
        {
            "canonicalUrl",
            "documentKey",
            "fetchedAt",
            "publishedAt",
            "rawHash",
            "rawText",
            "rawJson",
            "parsedFields",
        },
    )
    if (
        fields["canonicalUrl"] != (record.get("canonicalUrl") or record["url"])
        or fields["documentKey"] is not None
    ):
        raise ValueError("Prepared receipt canonical identity mismatch")
    if _prepared_time(fields["publishedAt"]) != published:
        raise ValueError("Prepared receipt publication date mismatch")
    body = fields["rawText"]
    if not isinstance(body, str):
        raise ValueError("Prepared receipt article text is required")
    receipt = news._article_receipt(body, record["title"], fields["canonicalUrl"], published)
    if receipt is None or receipt.raw_text != body or receipt.raw_hash != fields["rawHash"]:
        raise ValueError("Prepared receipt article or content hash is invalid")
    fetched = _prepared_time(fields["fetchedAt"])
    if (
        fetched.timestamp() < (record.get("documentFetchedAt") or 0)
        or fetched.timestamp() > datetime.now(timezone.utc).timestamp() + 300
    ):
        raise ValueError("Prepared receipt retrieval date is invalid")
    receipt.fetched_at = fetched
    receipt.parsed_fields = _prepared_provenance(fields, record)
    receipt.raw_json = fields["rawJson"]
    return receipt


def _prepared_event(item: dict, record: dict) -> Event:
    raw_hash = original_event_hash(record)
    registered_feeds.public_url(record["url"])
    published = datetime.fromtimestamp(record["publishedAt"], tz=timezone.utc)
    expected = {
        "source": record["source"],
        "sourceUrl": record["url"],
        "publishedAt": published.isoformat(),
        "title": record["title"],
        "content": record["content"],
        "primaryEntityId": record.get("entity"),
        "rawHash": raw_hash,
        "fetchRunId": None,
    }
    _prepared_object(item, {*expected, "sourceDocument"})
    if any(item[key] != value for key, value in expected.items()):
        raise ValueError("Prepared replay changed an original event field")
    receipt = _prepared_receipt(item["sourceDocument"], record, published)
    return Event(
        id=record["id"],
        source=record["source"],
        source_url=record["url"],
        published_at=published,
        title=record["title"],
        content=record["content"],
        primary_entity_id=record.get("entity"),
        raw_hash=raw_hash,
        source_document=receipt,
    )


async def prepared_repairs(
    ids: list[str], api_base: str, client: httpx.AsyncClient, path: Path
) -> list[Event]:
    ids = event_ids(",".join(ids))
    with path.open("rb") as stream:
        encoded = stream.read(MAX_PREPARED_BYTES + 1)
    if len(encoded) > MAX_PREPARED_BYTES:
        raise ValueError("Prepared replay exceeds the 60000-byte limit")
    payload = _prepared_object(json.loads(encoded), {"events"})
    items = payload["events"]
    if not isinstance(items, list) or len(items) != len(ids):
        raise ValueError("Prepared replay must match the explicit event allowlist")
    by_id: dict[str, dict] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("rawHash"), str):
            raise ValueError("Prepared replay requires original event identities")
        identity = hashlib.sha256(item["rawHash"].encode()).hexdigest()[:16]
        if identity not in ids or identity in by_id:
            raise ValueError("Prepared replay has an unlisted or duplicate event")
        by_id[identity] = item
    records = [await public_record(client, api_base, identity) for identity in ids]
    return [_prepared_event(by_id[record["id"]], record) for record in records]


def preview_payload(events: list[Event]) -> dict:
    return {"events": [audit._event_payload(event, None) for event in events]}


def _run_metadata_recovery(args: argparse.Namespace) -> None:
    event_id = args.event_ids[0]
    try:
        _require_admin_target(args.api_base)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    async def recover() -> None:
        async with httpx.AsyncClient(
            headers={"User-Agent": news.USER_AGENT, "Cache-Control": "no-cache"},
            timeout=20,
            follow_redirects=False,
        ) as client:
            if args.rollback:
                item = _load_metadata_preview(args.preview_file, event_id)
                await rollback_metadata_recovery(item, args.api_base, client)
                args.preview_file.write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
                print(json.dumps({"eventId": event_id, "rolledBack": True}))
                return

            if args.apply:
                preview = _load_metadata_preview(args.preview_file, event_id)
                recovery = preview["recovery"]
                plan = preview["applyPlan"]
                if (
                    preview["applied"]
                    or not isinstance(plan, dict)
                    or plan != _recovery_plan(recovery)
                ):
                    raise ValueError(
                        "Apply requires an unapplied, reviewed preview with a valid recovery plan"
                    )
                await _verify_saved_recovery(preview, args.api_base, client)
                response = await post_admin_json(
                    client,
                    args.api_base,
                    f"/admin/news-receipts/{event_id}/apply",
                    {
                        "before": recovery["before"],
                        "fingerprint": plan["beforeFingerprint"],
                        **recovery["after"],
                    },
                )
                if response.get("fingerprint") != plan["expectedAfterFingerprint"]:
                    raise ValueError(
                        "Apply response differs from the precomputed after-state fingerprint"
                    )
                preview["appliedFingerprint"] = response.get("fingerprint")
                preview["applied"] = True
                args.preview_file.write_text(
                    json.dumps(preview, indent=2, ensure_ascii=False) + "\n"
                )
            else:
                recovery = await prepare_metadata_recovery(event_id, args.api_base, client)
                preview = {
                    "recovery": recovery,
                    "applyPlan": _recovery_plan(recovery),
                    "appliedFingerprint": None,
                    "applied": False,
                    "rollbackFingerprint": None,
                }
                args.preview_file.write_text(
                    json.dumps(preview, indent=2, ensure_ascii=False) + "\n"
                )
            print(
                json.dumps(
                    {
                        "eventId": event_id,
                        "sourceUrl": recovery["sourceUrl"],
                        "title": recovery["title"],
                        "publishedAt": recovery["publishedAt"],
                        "retrievedUrl": recovery["retrievedUrl"],
                        "articleChars": recovery["articleChars"],
                        "articleHash": recovery["articleHash"],
                        "alignedToTitle": recovery["alignedToTitle"],
                        "applied": args.apply,
                    }
                )
            )

    asyncio.run(recover())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-ids", required=True, type=event_ids)
    parser.add_argument(
        "--api-base", default=os.environ.get("API_BASE", "https://api.highsignal.app")
    )
    parser.add_argument("--preview-file", type=Path, required=True)
    parser.add_argument(
        "--prepared-file",
        type=Path,
        help="Validate a prior public article preview instead of refetching publishers",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--apply", action="store_true", help="Apply the explicitly previewed repair"
    )
    action.add_argument(
        "--rollback",
        action="store_true",
        help="Restore the exact pre-repair receipt from the preview",
    )
    parser.add_argument(
        "--metadata-only-recovery",
        action="store_true",
        help="Use the narrow metadata-only news receipt recovery endpoint",
    )
    args = parser.parse_args()
    if args.rollback and not args.metadata_only_recovery:
        raise SystemExit("Rollback is supported only for metadata-only recovery previews")
    if args.metadata_only_recovery and (len(args.event_ids) != 1 or args.prepared_file):
        raise SystemExit("Metadata-only recovery requires one explicit event ID")
    if (
        args.apply
        and not args.metadata_only_recovery
        and (
            not audit._enabled()
            or (audit._api_base() or "").rstrip("/") != args.api_base.rstrip("/")
        )
    ):
        raise SystemExit("Authenticated ingest must target the same API as the public preview")

    if args.metadata_only_recovery:
        _run_metadata_recovery(args)
        return

    async def prepare() -> list[Event]:
        async with httpx.AsyncClient(
            headers={"User-Agent": news.USER_AGENT, "Cache-Control": "no-cache"},
            timeout=20,
            follow_redirects=False,
        ) as client:
            if args.prepared_file:
                return await prepared_repairs(
                    args.event_ids, args.api_base, client, args.prepared_file
                )
            return await prepare_repairs(args.event_ids, args.api_base, client)

    events = asyncio.run(prepare())
    args.preview_file.write_text(
        json.dumps(preview_payload(events), indent=2, ensure_ascii=False) + "\n"
    )
    print(
        json.dumps(
            {
                "preview": str(args.preview_file),
                "records": [
                    {
                        "id": event.id,
                        "source": event.source,
                        "originalEntity": event.primary_entity_id,
                        "articleChars": len(event.source_document.raw_text or ""),
                        "articleHash": event.source_document.raw_hash,
                    }
                    for event in events
                ],
            }
        )
    )
    if args.apply:
        acknowledged = audit.push_events(events, None)
        print(json.dumps({"acknowledged": acknowledged, "expected": len(events)}))
        if acknowledged != len(events):
            raise SystemExit("Receipt replay was not fully acknowledged")


if __name__ == "__main__":
    main()
