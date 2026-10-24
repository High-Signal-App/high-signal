"""Preview-first replay of unchanged public CFTC observations into exact receipts.

Only the normal admin ingest path may repair the legacy URL/document association.
No source facts, event identity, published claims or original shared receipt change.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import httpx

from . import audit
from .sources.registered_feeds import fetch_public_document
from .types import Event, SourceDocument
from .utils import event_hash

SOURCE = "us-gov-api:cftc-cot"
DATASET = "https://publicreporting.cftc.gov/resource/jun7-fc8e.json"
LEGACY_URLS = {
    f"{origin}/MarketReports/CommitmentsofTraders/index.htm"
    for origin in (
        "http://www.cftc.gov",
        "https://www.cftc.gov",
        "http://cftc.gov",
        "https://cftc.gov",
    )
}
TITLE = re.compile(r"CFTC CoT: (.+) \((\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?)?)\)")


@dataclass(frozen=True)
class RepairPlan:
    events: list[Event]
    scanned: int
    next_cursor: str | None


def repair_event(record: dict) -> Event | None:
    """Derive a receipt solely from a cryptographically verified stored observation."""
    if record.get("source") != SOURCE:
        raise ValueError("The public page contains a different source")
    if record.get("url") not in LEGACY_URLS:
        return None
    title, content = record.get("title"), record.get("content")
    match = TITLE.fullmatch(title) if isinstance(title, str) else None
    if not match or not isinstance(content, str) or type(record.get("publishedAt")) is not int:
        raise ValueError("A complete original CFTC observation is required")
    contract, report_date = match.groups()
    published = datetime.fromisoformat(report_date[:10]).replace(tzinfo=timezone.utc)
    if int(published.timestamp()) != record["publishedAt"]:
        raise ValueError("CFTC title and publication date disagree")
    prefix = f"CFTC CoT {contract} for {report_date}.\nNon-commercial long: "
    positions = re.fullmatch(re.escape(prefix) + r"(\d*), short: (\d*), net: (-?\d*)\.", content)
    if not positions:
        raise ValueError("CFTC title and stored content disagree")
    long, short, net = positions.groups()
    expected_net = str(int(long) - int(short)) if long and short else ""
    if net != expected_net:
        raise ValueError("CFTC stored net positioning disagrees")
    raw_hash = event_hash(SOURCE, contract, report_date)
    if hashlib.sha256(raw_hash.encode()).hexdigest()[:16] != record.get("id"):
        raise ValueError("The original CFTC identity could not be verified")
    url = f"{DATASET}?{urlencode({'market_and_exchange_names': contract, 'report_date_as_yyyy_mm_dd': report_date})}"
    return Event(
        id=record["id"],
        source=SOURCE,
        source_url=url,
        title=title,
        content=content,
        published_at=published,
        primary_entity_id=record.get("entity"),
        raw_hash=raw_hash,
        source_document=SourceDocument(
            canonical_url=url,
            fetched_at=datetime.now(timezone.utc),
            published_at=published,
            raw_hash=raw_hash,
            raw_text=content,
            parsed_fields={
                "documentKind": "cftc_contract_report",
                "contract": contract,
                "reportDate": report_date,
                "reconstructedFrom": "retained_cftc_observation",
                "originalEventId": record["id"],
            },
        ),
    )


def page_records(page: object, limit: int) -> list[dict]:
    if (
        not isinstance(page, dict)
        or page.get("available") is not True
        or page.get("id") != "us-gov-api"
    ):
        raise ValueError("Public CFTC page is unavailable")
    rows = page.get("events")
    if not isinstance(rows, list) or len(rows) > limit or type(page.get("hasMore")) is not bool:
        raise ValueError("Invalid public CFTC pagination response")
    return rows


async def prepare_repairs(
    client: httpx.AsyncClient, api_base: str, max_rows: int = 10_000, cursor: str | None = None
) -> RepairPlan:
    if not 1 <= max_rows <= 10_000:
        raise ValueError("max_rows must be between 1 and 10000")
    events: list[Event] = []
    scanned = 0
    seen: set[str] = set()
    cursors = {cursor} if cursor else set()
    while scanned < max_rows:
        limit = min(200, max_rows - scanned)
        params = {"source": SOURCE, "limit": str(limit)}
        if cursor:
            params["cursor"] = cursor
        document = await fetch_public_document(
            client, f"{api_base.rstrip('/')}/data/sources/us-gov-api?{urlencode(params)}"
        )
        page = json.loads(document.text)
        rows = page_records(page, limit)
        for record in rows:
            if (
                not isinstance(record, dict)
                or not isinstance(record.get("id"), str)
                or record["id"] in seen
            ):
                raise ValueError("Duplicate or invalid public observation")
            seen.add(record["id"])
            event = repair_event(record)
            if event:
                events.append(event)
        scanned += len(rows)
        if not page["hasMore"]:
            return RepairPlan(events, scanned, None)
        cursor = page.get("nextCursor")
        if not rows or not isinstance(cursor, str) or not cursor or cursor in cursors:
            raise ValueError("Public CFTC cursor did not advance")
        cursors.add(cursor)
    return RepairPlan(events, scanned, cursor)


def preview_payload(plan: RepairPlan) -> dict:
    return {
        "source": SOURCE,
        "scanned": plan.scanned,
        "nextCursor": plan.next_cursor,
        "recordIds": [event.id for event in plan.events],
        "events": [audit._event_payload(event, None) for event in plan.events],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-base", default=os.environ.get("API_BASE", "https://api.highsignal.app")
    )
    parser.add_argument("--max-rows", type=int, default=10_000)
    parser.add_argument(
        "--cursor", help="Resume after the prior successful preview/apply page boundary"
    )
    parser.add_argument("--preview-file", type=Path, required=True)
    parser.add_argument(
        "--apply", action="store_true", help="Use normal authenticated audit ingest"
    )
    args = parser.parse_args()
    if not 1 <= args.max_rows <= 10_000:
        parser.error("--max-rows must be between 1 and 10000")
    if args.apply and (
        not audit._enabled() or (audit._api_base() or "").rstrip("/") != args.api_base.rstrip("/")
    ):
        raise SystemExit("Authenticated ingest must target the same API as the public preview")

    async def prepare() -> RepairPlan:
        async with httpx.AsyncClient(
            headers={
                "User-Agent": "HighSignal/1.0 public CFTC receipt replay",
                "Cache-Control": "no-cache",
            },
            timeout=30,
            follow_redirects=False,
        ) as client:
            return await prepare_repairs(client, args.api_base, args.max_rows, args.cursor)

    plan = asyncio.run(prepare())
    args.preview_file.write_text(
        json.dumps(preview_payload(plan), indent=2, ensure_ascii=False) + "\n"
    )
    print(
        json.dumps(
            {
                "preview": str(args.preview_file),
                "scanned": plan.scanned,
                "legacyRecords": len(plan.events),
                "nextCursor": plan.next_cursor,
            }
        )
    )
    if args.apply:
        acknowledged = 0
        for offset in range(0, len(plan.events), 25):
            batch = plan.events[offset : offset + 25]
            accepted = audit.push_events(batch, None)
            acknowledged += accepted
            if accepted != len(batch):
                print(json.dumps({"acknowledged": acknowledged, "expected": len(plan.events)}))
                raise SystemExit("Replay not fully acknowledged; rerun the same scan cursor safely")
        print(
            json.dumps(
                {
                    "acknowledged": acknowledged,
                    "expected": len(plan.events),
                    "nextCursor": plan.next_cursor,
                }
            )
        )


if __name__ == "__main__":
    main()
