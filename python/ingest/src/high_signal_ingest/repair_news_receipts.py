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
from .types import Event
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


def preview_payload(events: list[Event]) -> dict:
    return {
        "events": [
            {
                "source": event.source,
                "sourceUrl": event.source_url,
                "publishedAt": event.published_at.isoformat(),
                "title": event.title,
                "content": event.content,
                "primaryEntityId": event.primary_entity_id,
                "rawHash": event.raw_hash,
                "fetchRunId": None,
                "sourceDocument": audit._source_document_payload(event),
            }
            for event in events
        ]
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-ids", required=True, type=event_ids)
    parser.add_argument(
        "--api-base", default=os.environ.get("API_BASE", "https://api.highsignal.app")
    )
    parser.add_argument("--preview-file", type=Path, required=True)
    parser.add_argument(
        "--apply", action="store_true", help="Use the normal authenticated audit ingest API"
    )
    args = parser.parse_args()

    async def prepare() -> list[Event]:
        async with httpx.AsyncClient(
            headers={"User-Agent": news.USER_AGENT, "Cache-Control": "no-cache"},
            timeout=20,
            follow_redirects=False,
        ) as client:
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
        if not audit._enabled():
            raise SystemExit("Authenticated ingest persistence is unavailable")
        acknowledged = audit.push_events(events, None)
        print(json.dumps({"acknowledged": acknowledged, "expected": len(events)}))
        if acknowledged != len(events):
            raise SystemExit("Receipt replay was not fully acknowledged")


if __name__ == "__main__":
    main()
