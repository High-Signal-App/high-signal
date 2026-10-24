from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from high_signal_ingest import repair_cftc_receipts as repair
from high_signal_ingest.sources import registered_feeds
from high_signal_ingest.utils import event_hash


def record(contract="ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC", date="2026-10-13T00:00:00.000"):
    raw = event_hash(repair.SOURCE, contract, date)
    return {
        "id": hashlib.sha256(raw.encode()).hexdigest()[:16],
        "source": repair.SOURCE,
        "url": "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
        "title": f"CFTC CoT: {contract} ({date})",
        "content": f"CFTC CoT {contract} for {date}.\nNon-commercial long: 8383, short: 7234, net: 1149.",
        "entity": "preserved-entity",
        "publishedAt": int(
            datetime.fromisoformat(date[:10]).replace(tzinfo=timezone.utc).timestamp()
        ),
    }, raw


def test_real_legacy_zcash_tuple_derives_exact_identity_and_receipt_without_new_facts():
    original, raw = record()
    before = dict(original)
    event = repair.repair_event(original)
    assert original == before
    assert event.id == original["id"] == "6703067e2f0b32b8"
    assert event.raw_hash == raw
    assert event.title == original["title"]
    assert event.content == original["content"]
    assert event.primary_entity_id == original["entity"]
    assert int(event.published_at.timestamp()) == original["publishedAt"]
    assert parse_qs(urlsplit(event.source_url).query) == {
        "market_and_exchange_names": ["ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC"],
        "report_date_as_yyyy_mm_dd": ["2026-10-13T00:00:00.000"],
    }
    receipt = event.source_document
    assert receipt.canonical_url == event.source_url
    assert receipt.raw_hash == raw
    assert receipt.raw_text == original["content"]
    assert receipt.published_at == event.published_at
    assert receipt.parsed_fields == {
        "documentKind": "cftc_contract_report",
        "contract": "ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC",
        "reportDate": "2026-10-13T00:00:00.000",
        "reconstructedFrom": "retained_cftc_observation",
        "originalEventId": original["id"],
    }
    assert receipt.raw_json is None


@pytest.mark.parametrize(
    "change",
    [
        {"id": "0" * 16},
        {"source": "news:cftc"},
        {"title": None},
        {"publishedAt": 1},
        {"publishedAt": True},
        {"content": "CFTC unrelated observation"},
        {
            "content": "CFTC CoT ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC for 2026-10-13T00:00:00.000.\nNon-commercial long: 8383, short: 7234, net: 0."
        },
    ],
)
def test_inconsistent_original_tuple_fails_closed(change):
    original, _ = record()
    with pytest.raises(ValueError):
        repair.repair_event({**original, **change})


def test_already_exact_receipts_are_skipped_for_idempotent_restart():
    original, _ = record()
    original["url"] = repair.repair_event(original).source_url
    assert repair.repair_event(original) is None


async def prepare(monkeypatch, pages, max_rows=10000, cursor=None):
    requests = []

    async def public_host(_url):
        return None

    monkeypatch.setattr(registered_feeds, "check_public_host", public_host)

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=pages[len(requests) - 1])

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        plan = await repair.prepare_repairs(client, "https://api.example", max_rows, cursor)
    return plan, requests


def page(rows, cursor=None):
    return {
        "id": "us-gov-api",
        "available": True,
        "events": rows,
        "hasMore": cursor is not None,
        "nextCursor": cursor,
    }


def test_source_filtered_cursor_pagination_preserves_exact_old_observations(monkeypatch):
    old, _ = record()
    second, _ = record("SUI - COINBASE DERIVATIVES, LLC", "2026-06-16T00:00:00.000")
    plan, requests = asyncio.run(prepare(monkeypatch, [page([old], "cursor-one"), page([second])]))
    assert plan.scanned == 2
    assert plan.next_cursor is None
    assert [event.id for event in plan.events] == [old["id"], second["id"]]
    assert all(request.url.path == "/data/sources/us-gov-api" for request in requests)
    assert all(request.url.params["source"] == repair.SOURCE for request in requests)
    assert requests[0].url.params["limit"] == "200"
    assert requests[1].url.params["cursor"] == "cursor-one"


def test_bounded_scan_returns_next_cursor_and_can_resume_skipping_corrected_rows(monkeypatch):
    current, _ = record("SUI - COINBASE DERIVATIVES, LLC")
    current["url"] = repair.repair_event(current).source_url
    old, _ = record()
    plan, requests = asyncio.run(
        prepare(monkeypatch, [page([current], "cursor-one"), page([old], "cursor-two")], max_rows=2)
    )
    assert plan.scanned == 2
    assert plan.next_cursor == "cursor-two"
    assert [event.id for event in plan.events] == [old["id"]]
    assert [request.url.params["limit"] for request in requests] == ["2", "1"]
    resumed, requests = asyncio.run(prepare(monkeypatch, [page([])], cursor=plan.next_cursor))
    assert resumed.events == []
    assert requests[0].url.params["cursor"] == "cursor-two"


@pytest.mark.parametrize(
    "pages",
    [
        [{"available": False}],
        [page([], "stalled")],
        [page([record()[0]], "same"), page([record("SUI")[0]], "same")],
        [page([record()[0]], "next"), page([record()[0]])],
        [{**page([]), "hasMore": "true"}],
    ],
)
def test_unavailable_duplicate_or_stalled_pages_abort_before_any_apply(monkeypatch, pages):
    with pytest.raises(ValueError):
        asyncio.run(prepare(monkeypatch, pages))


@pytest.mark.parametrize("max_rows", [0, -1, 10001])
def test_scan_limit_is_bounded_before_http(monkeypatch, max_rows):
    with pytest.raises(ValueError, match="max_rows"):
        asyncio.run(prepare(monkeypatch, [], max_rows=max_rows))


@pytest.mark.parametrize("apply", [False, True])
def test_cli_previews_first_then_uses_normal_audit_in_bounded_batches(monkeypatch, tmp_path, apply):
    events = [repair.repair_event(record(f"CONTRACT {i}")[0]) for i in range(51)]
    plan = repair.RepairPlan(events, 60, "next-page")

    async def prepared(*_args):
        return plan

    monkeypatch.setattr(repair, "prepare_repairs", prepared)
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://api.example")
    preview = tmp_path / "preview.json"
    batches = []

    def push(batch, run_id):
        assert json.loads(preview.read_text()) == repair.preview_payload(plan)
        assert run_id is None
        batches.append(batch)
        return len(batch)

    monkeypatch.setattr(repair.audit, "push_events", push)
    monkeypatch.setattr(
        sys,
        "argv",
        ["repair", "--api-base", "https://api.example", "--preview-file", str(preview)]
        + (["--apply"] if apply else []),
    )
    repair.main()
    assert json.loads(preview.read_text()) == repair.preview_payload(plan)
    assert [len(batch) for batch in batches] == ([25, 25, 1] if apply else [])


def test_partial_acknowledgement_stops_and_can_restart_from_same_scan(monkeypatch, tmp_path):
    events = [repair.repair_event(record(f"CONTRACT {i}")[0]) for i in range(75)]

    async def prepared(*_args):
        return repair.RepairPlan(events, 75, None)

    batches = []

    def push(batch, _run_id):
        batches.append(batch)
        return 25 if len(batches) == 1 else 0

    monkeypatch.setattr(repair, "prepare_repairs", prepared)
    monkeypatch.setattr(repair.audit, "push_events", push)
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://api.example")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "repair",
            "--api-base",
            "https://api.example",
            "--preview-file",
            str(tmp_path / "preview.json"),
            "--apply",
        ],
    )
    with pytest.raises(SystemExit, match="rerun the same scan"):
        repair.main()
    assert len(batches) == 2


def test_apply_rejects_a_different_authenticated_target_before_reading(monkeypatch, tmp_path):
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://other.example")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "repair",
            "--api-base",
            "https://api.example",
            "--preview-file",
            str(tmp_path / "preview.json"),
            "--apply",
        ],
    )
    with pytest.raises(SystemExit, match="same API"):
        repair.main()
    assert not (tmp_path / "preview.json").exists()
