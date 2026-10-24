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
from datetime import datetime, timezone
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
    parser.add_argument(
        "--apply", action="store_true", help="Use the normal authenticated audit ingest API"
    )
    args = parser.parse_args()
    if args.apply and (
        not audit._enabled() or (audit._api_base() or "").rstrip("/") != args.api_base.rstrip("/")
    ):
        raise SystemExit("Authenticated ingest must target the same API as the public preview")

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
