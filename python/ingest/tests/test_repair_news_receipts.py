from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from datetime import UTC, datetime, timezone

import httpx
import pytest

from high_signal_ingest import repair_news_receipts as repair
from high_signal_ingest.utils import event_hash


def record(kind="rss"):
    url = "https://publisher.example/article"
    source = "news:publisher" if kind == "rss" else "news:digg-verification:publisher.example"
    content = "AI - unrelated navigation. " * 30
    raw = (
        event_hash("publisher", url)
        if kind == "rss"
        else hashlib.sha256(content.encode()).hexdigest()
    )
    return {
        "id": hashlib.sha256(raw.encode()).hexdigest()[:16],
        "source": source,
        "url": url,
        "canonicalUrl": url,
        "title": "IBM CEO backs customer models",
        "content": content,
        "retainedText": content,
        "retainedTextTruncated": False,
        "entity": "AAPL",
        "publishedAt": 1792807200,
        "documentFetchedAt": 1792810626,
        "available": True,
    }, raw


@pytest.mark.parametrize("kind", ["rss", "attention"])
def test_replay_keeps_verified_original_observation_and_retains_replaced_public_receipt(
    monkeypatch, kind
):
    original, raw = record(kind)
    body = (
        "IBM announced public models running on customer hardware with documented deployment support. "
        * 12
    )

    async def public_host(_url):
        return None

    monkeypatch.setattr(repair.registered_feeds, "check_public_host", public_host)

    def respond(request):
        if request.url.host == "api.example":
            return httpx.Response(200, json=original)
        return httpx.Response(
            200, text=f"<article><h1>{original['title']}</h1><p>{body}</p></article>"
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await repair.prepare_repairs([original["id"]], "https://api.example", client)

    [event] = asyncio.run(run())
    assert event.id == original["id"]
    assert event.raw_hash == raw
    assert event.source == original["source"]
    assert event.source_url == original["url"]
    assert event.title == original["title"]
    assert event.content == original["content"]
    assert event.primary_entity_id == original["entity"]
    assert event.published_at == datetime.fromtimestamp(original["publishedAt"], timezone.utc)
    assert body.strip() in event.source_document.raw_text
    assert "unrelated navigation" not in event.source_document.raw_text
    assert event.source_document.raw_json == {"previousPublicRecord": original}
    payload = repair.preview_payload([event])["events"][0]
    assert payload["content"] == original["content"]
    assert (
        payload["sourceDocument"]["rawHash"]
        == hashlib.sha256(event.source_document.raw_text.encode()).hexdigest()
    )


def test_unverifiable_original_identity_fails_closed():
    original, _raw = record()
    original["id"] = "0" * 16
    with pytest.raises(ValueError, match="identity"):
        repair.original_event_hash(original)


def test_thin_or_unaligned_public_article_cannot_prepare_a_replay(monkeypatch):
    original, _raw = record()

    async def public_host(_url):
        return None

    monkeypatch.setattr(repair.registered_feeds, "check_public_host", public_host)

    def respond(request):
        if request.url.host == "api.example":
            return httpx.Response(200, json=original)
        return httpx.Response(
            200, text="<article><p>Microsoft announced an unrelated product.</p></article>"
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await repair.prepare_repairs([original["id"]], "https://api.example", client)

    with pytest.raises(ValueError, match="No substantive aligned public article"):
        asyncio.run(run())


@pytest.mark.parametrize(
    "value", ["", "not-an-id", "a" * 16 + "," + "a" * 16, ",".join(["a" * 16, "b" * 16, "c" * 16])]
)
def test_explicit_id_input_is_bounded(value):
    with pytest.raises(argparse.ArgumentTypeError):
        repair.event_ids(value)


def metadata_dispatch_preview(event_id="a" * 16):
    event = {"id": event_id, "source": "news:publisher", "content": None}
    document = {"id": "doc", "rawText": None, "rawJson": None}
    before = {"event": event, "document": document}
    after = {
        "fetchedAt": 1792638003,
        "rawHash": "b" * 64,
        "rawText": "public article body",
        "rawJson": "{}",
        "parsedFields": "{}",
    }
    recovery = {
        "eventId": event_id,
        "source": "news:publisher",
        "sourceUrl": "https://publisher.example/story",
        "title": "A public news story",
        "publishedAt": "2026-10-21T13:26:00+00:00",
        "pagePublicationDates": ["2026-10-21T00:00:00+00:00"],
        "retrievedUrl": "https://publisher.example/story",
        "articleChars": len(after["rawText"]),
        "articleHash": after["rawHash"],
        "alignedToTitle": True,
        "originalRawHash": "c" * 64,
        "before": before,
        "beforeFingerprint": repair._state_fingerprint(before),
        "after": after,
    }
    result = {
        "recovery": recovery,
        "applyPlan": None,
        "appliedFingerprint": None,
        "applied": False,
        "rollbackFingerprint": None,
    }
    result["applyPlan"] = repair._recovery_plan(recovery)
    return result


@pytest.mark.parametrize("mode", ["metadata-only-apply", "metadata-only-rollback"])
def test_metadata_dispatch_input_accepts_single_saved_preview(mode):
    preview = json.dumps(metadata_dispatch_preview())
    result = repair.validate_metadata_dispatch_input(mode, "a" * 16, preview)
    assert result["recovery"]["eventId"] == "a" * 16


@pytest.mark.parametrize(
    ("mode", "ids", "mutate", "message"),
    [
        ("standard", "a" * 16, None, "Unsupported"),
        ("metadata-only-apply", "a" * 16 + "," + "b" * 16, None, "one event"),
        ("metadata-only-apply", "b" * 16, None, "explicit event ID"),
        ("metadata-only-apply", "a" * 16, "applied", "unapplied"),
    ],
)
def test_metadata_dispatch_input_rejects_unreviewable_requests(mode, ids, mutate, message):
    preview = metadata_dispatch_preview()
    if mutate == "applied":
        preview["applied"] = True
    with pytest.raises((ValueError, argparse.ArgumentTypeError), match=message):
        repair.validate_metadata_dispatch_input(mode, ids, json.dumps(preview))


def test_metadata_dispatch_input_rejects_oversized_or_missing_preview():
    with pytest.raises(ValueError, match="60000-byte"):
        repair.validate_metadata_dispatch_input("metadata-only-apply", "a" * 16, " " * 60_001)
    with pytest.raises(ValueError, match="saved preview"):
        repair.validate_metadata_dispatch_input("metadata-only-rollback", "a" * 16, "")


@pytest.mark.parametrize("apply", [False, True])
def test_cli_previews_before_optional_normal_persistence(monkeypatch, tmp_path, apply):
    original, raw = record()
    from high_signal_ingest.types import Event

    event = Event(
        id=original["id"],
        source=original["source"],
        source_url=original["url"],
        published_at=datetime.now(timezone.utc),
        content=original["content"],
        raw_hash=raw,
    )

    async def prepare(*_args):
        from high_signal_ingest.types import SourceDocument

        event.source_document = SourceDocument(raw_text="public article body", raw_hash="new-hash")
        return [event]

    monkeypatch.setattr(repair, "prepare_repairs", prepare)
    preview = tmp_path / "preview.json"
    persisted = []

    def push(events, run_id):
        assert json.loads(preview.read_text()) == repair.preview_payload(events)
        assert run_id is None
        persisted.extend(events)
        return len(events)

    monkeypatch.setattr(repair.audit, "push_events", push)
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://api.highsignal.app")
    monkeypatch.setattr(
        sys,
        "argv",
        ["repair", "--event-ids", original["id"], "--preview-file", str(preview)]
        + (["--apply"] if apply else []),
    )
    repair.main()
    assert json.loads(preview.read_text()) == repair.preview_payload([event])
    assert persisted == ([event] if apply else [])


def prepared_fixture(kind="rss"):
    original, raw = record(kind)
    published = datetime.fromtimestamp(original["publishedAt"], timezone.utc)
    body = "IBM announced public customer models with documented deployment support. " * 15
    receipt = repair.news._article_receipt(
        body, original["title"], original["canonicalUrl"], published
    )
    receipt.fetched_at = datetime.now(timezone.utc)
    receipt.raw_json = {"previousPublicRecord": original}
    receipt.parsed_fields.update(
        {
            "receiptRepairEventId": original["id"],
            "retrievedUrl": original["url"],
            "previousDocumentFetchedAt": original["documentFetchedAt"],
        }
    )
    from high_signal_ingest.types import Event

    event = Event(
        id=original["id"],
        source=original["source"],
        source_url=original["url"],
        published_at=published,
        title=original["title"],
        content=original["content"],
        primary_entity_id=original["entity"],
        raw_hash=raw,
        source_document=receipt,
    )
    return original, event


def run_prepared(monkeypatch, tmp_path, records, payload):
    path = tmp_path / "prepared.json"
    path.write_text(json.dumps(payload))
    requested = []

    async def public_host(_url):
        return None

    monkeypatch.setattr(repair.registered_feeds, "check_public_host", public_host)

    def respond(request):
        assert request.url.host == "api.example", "prepared mode fetched a publisher"
        identity = request.url.path.rsplit("/", 1)[-1]
        requested.append(identity)
        return httpx.Response(
            200, json=next(record for record in records if record["id"] == identity)
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await repair.prepared_repairs(
                [record["id"] for record in records], "https://api.example", client, path
            )

    return run, requested


def test_prepared_preview_reloads_both_records_without_publisher_fetch(monkeypatch, tmp_path):
    first, one = prepared_fixture("rss")
    second, two = prepared_fixture("attention")
    payload = repair.preview_payload([one, two])
    run, requested = run_prepared(monkeypatch, tmp_path, [first, second], payload)
    events = asyncio.run(run())
    assert requested == [first["id"], second["id"]]
    assert repair.preview_payload(events) == payload


@pytest.mark.parametrize(
    "field,value",
    [
        ("source", "news:other"),
        ("sourceUrl", "https://other.example/article"),
        ("title", "Different article"),
        ("content", "Different original content"),
        ("primaryEntityId", "IBM"),
        ("publishedAt", "2026-10-25T02:00:00+00:00"),
        ("fetchRunId", "new-association"),
    ],
)
def test_prepared_event_manipulation_rejected_after_current_reads(
    monkeypatch, tmp_path, field, value
):
    first, one = prepared_fixture("rss")
    second, two = prepared_fixture("attention")
    payload = repair.preview_payload([one, two])
    payload["events"][0][field] = value
    run, requested = run_prepared(monkeypatch, tmp_path, [first, second], payload)
    with pytest.raises(ValueError, match="original event field"):
        asyncio.run(run())
    assert requested == [first["id"], second["id"]]


@pytest.mark.parametrize(
    "field,value",
    [
        ("canonicalUrl", "https://other.example/article"),
        ("documentKey", "other-document"),
        ("rawHash", "forged-body-hash"),
        ("rawText", "Short text"),
        ("publishedAt", "2026-10-25T02:00:00Z"),
        ("fetchedAt", "2020-01-01T00:00:00Z"),
        ("rawJson", {"previousPublicRecord": {"available": True}}),
    ],
)
def test_prepared_receipt_manipulation_rejected(monkeypatch, tmp_path, field, value):
    original, event = prepared_fixture()
    payload = repair.preview_payload([event])
    payload["events"][0]["sourceDocument"][field] = value
    run, _ = run_prepared(monkeypatch, tmp_path, [original], payload)
    with pytest.raises(ValueError):
        asyncio.run(run())


@pytest.mark.parametrize(
    "field,value",
    [
        ("documentKind", "attention_aggregator"),
        ("retrievedFrom", "private_mail"),
        ("receiptRepairEventId", "0" * 16),
        ("previousDocumentFetchedAt", 0),
        ("retrievedUrl", "https://publisher.example/article?token=private"),
    ],
)
def test_prepared_provenance_manipulation_rejected(monkeypatch, tmp_path, field, value):
    original, event = prepared_fixture()
    payload = repair.preview_payload([event])
    payload["events"][0]["sourceDocument"]["parsedFields"][field] = value
    run, _ = run_prepared(monkeypatch, tmp_path, [original], payload)
    with pytest.raises((ValueError, repair.registered_feeds.UnsafeFeedUrl)):
        asyncio.run(run())


def test_prepared_allowlist_and_size_are_bounded(monkeypatch, tmp_path):
    original, event = prepared_fixture()
    payload = repair.preview_payload([event, event])
    run, requested = run_prepared(monkeypatch, tmp_path, [original], payload)
    with pytest.raises(ValueError, match="allowlist"):
        asyncio.run(run())
    assert not requested
    path = tmp_path / "oversized.json"
    path.write_bytes(b"x" * (repair.MAX_PREPARED_BYTES + 1))

    async def oversized():
        async with httpx.AsyncClient() as client:
            await repair.prepared_repairs([original["id"]], "https://api.example", client, path)

    with pytest.raises(ValueError, match="60000-byte"):
        asyncio.run(oversized())


def test_prepared_unknown_identity_and_extra_fields_are_rejected(monkeypatch, tmp_path):
    original, event = prepared_fixture()
    payload = repair.preview_payload([event])
    payload["events"][0]["rawHash"] = "unknown"
    run, requested = run_prepared(monkeypatch, tmp_path, [original], payload)
    with pytest.raises(ValueError, match="unlisted"):
        asyncio.run(run())
    assert not requested
    payload = repair.preview_payload([event])
    payload["events"][0]["sourceDocument"]["arbitrary"] = "extra"
    run, _ = run_prepared(monkeypatch, tmp_path, [original], payload)
    with pytest.raises(ValueError, match="unexpected fields"):
        asyncio.run(run())


@pytest.mark.parametrize(
    "body",
    [
        "Microsoft announced an unrelated product with deployment support. " * 20,
        "Please log in to continue. IBM customer model article. " * 30,
    ],
)
def test_prepared_wrong_page_or_wall_is_rejected_even_with_matching_hash(
    monkeypatch, tmp_path, body
):
    original, event = prepared_fixture()
    payload = repair.preview_payload([event])
    document = payload["events"][0]["sourceDocument"]
    document["rawText"] = body
    document["rawHash"] = hashlib.sha256(body.encode()).hexdigest()
    run, _ = run_prepared(monkeypatch, tmp_path, [original], payload)
    with pytest.raises(ValueError, match="article or content hash"):
        asyncio.run(run())


def test_apply_cannot_read_from_one_api_and_write_to_another(monkeypatch, tmp_path):
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://other.example")
    preview = tmp_path / "preview.json"
    monkeypatch.setattr(
        sys,
        "argv",
        ["repair", "--event-ids", "a" * 16, "--preview-file", str(preview), "--apply"],
    )
    with pytest.raises(SystemExit, match="same API"):
        repair.main()
    assert not preview.exists()


def test_metadata_recovery_rolls_back_successful_server_write_after_lost_apply_ack(
    monkeypatch,
    tmp_path,
):
    url = "https://publisher.example/story"
    title = "Amazon withdraws its data center application"
    raw_hash = event_hash("publisher", url)
    event_id = hashlib.sha256(raw_hash.encode()).hexdigest()[:16]
    published_at = 1792589160
    record = {
        "id": event_id,
        "source": "news:publisher",
        "url": url,
        "canonicalUrl": url,
        "title": title,
        "content": None,
        "retainedText": None,
        "retainedTextTruncated": False,
        "entity": None,
        "publishedAt": published_at,
        "documentFetchedAt": 1792638003,
        "available": True,
    }
    before = {
        "event": {
            "id": event_id,
            "source": "news:publisher",
            "sourceUrl": url,
            "title": title,
            "content": None,
            "publishedAt": published_at,
            "primaryEntityId": None,
            "rawHash": raw_hash,
            "fetchRunId": "original-fetch-run",
            "sourceDocumentId": "source-doc-id",
        },
        "document": {
            "id": "source-doc-id",
            "source": "news:publisher",
            "canonicalUrl": url,
            "documentKey": "news:publisher:https://publisher.example/story",
            "fetchedAt": 1792638003,
            "publishedAt": published_at,
            "rawHash": "original-document-hash",
            "rawText": None,
            "rawJson": None,
            "parsedFields": '{"receiptKind":"metadata_only"}',
        },
    }
    body = (
        "Amazon withdrew its data center application following local opposition and revised plans. "
        * 8
    )
    html = (
        "<article><h1>Amazon withdraws its data center application</h1>"
        '<time itemprop="datePublished" datetime="2026-10-21">October 21, 2026</time>'
        f"<p>{body}</p></article>"
    )
    current_snapshot = {"state": before, "fingerprint": repair._state_fingerprint(before)}
    request_log = []

    async def public_host(_url):
        return None

    monkeypatch.setattr(repair.registered_feeds, "check_public_host", public_host)

    def respond(request):
        nonlocal current_snapshot
        if request.url.host == "api.example" and request.url.path.startswith("/data/records/"):
            return httpx.Response(200, json=record)
        if request.url.host == "api.example" and request.url.path.startswith(
            "/admin/news-receipts/"
        ):
            assert request.headers.get("Authorization") == "Bearer test-token"
            request_log.append((request.method, request.url.path))
            if request.method == "POST" and request.url.path.endswith("/rollback"):
                payload = json.loads(request.content)
                assert payload["before"] == before
                assert (
                    payload["afterFingerprint"]
                    == repair._recovery_plan(recovery)["expectedAfterFingerprint"]
                )
                current_snapshot = {
                    "state": before,
                    "fingerprint": repair._state_fingerprint(before),
                }
                return httpx.Response(200, json=current_snapshot)
            return httpx.Response(200, json=current_snapshot)
        return httpx.Response(200, text=html)

    monkeypatch.setattr(repair.audit, "_token", lambda: "test-token")
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://api.example")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await repair.prepare_metadata_recovery(event_id, "https://api.example", client)

    recovery = asyncio.run(run())
    assert recovery["eventId"] == event_id
    assert recovery["before"] == before
    assert recovery["beforeFingerprint"] == repair._state_fingerprint(before)
    assert recovery["publishedAt"] == "2026-10-21T13:26:00+00:00"
    assert recovery["pagePublicationDates"] == ["2026-10-21T00:00:00+00:00"]
    assert recovery["alignedToTitle"] is True
    assert recovery["articleChars"] >= 500
    assert (
        recovery["articleHash"] == hashlib.sha256(recovery["after"]["rawText"].encode()).hexdigest()
    )
    assert (
        json.loads(recovery["after"]["rawJson"])["receiptRecovery"]["originalDocument"]
        == before["document"]
    )
    plan = repair._recovery_plan(recovery)
    assert plan["bodyHash"] == recovery["articleHash"]
    assert plan["beforeFingerprint"] == recovery["beforeFingerprint"]
    assert len(plan["expectedAfterFingerprint"]) == 64
    preview_path = tmp_path / "preview.json"
    preview_path.write_text(
        json.dumps(
            {
                "recovery": recovery,
                "applyPlan": plan,
                "appliedFingerprint": None,
                "applied": False,
                "rollbackFingerprint": None,
            }
        )
    )
    preview = repair._load_metadata_preview(preview_path, event_id)
    assert preview["applyPlan"] == plan

    async def verify_saved_preview():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await repair._verify_saved_recovery(preview, "https://api.example", client)

    snapshot, verified_recovery = asyncio.run(verify_saved_preview())
    assert snapshot["fingerprint"] == plan["beforeFingerprint"]
    assert verified_recovery["articleHash"] == recovery["articleHash"]

    applied_document = dict(before["document"])
    applied_document.update(recovery["after"])
    applied_state = {"event": before["event"], "document": applied_document}
    # Model a committed apply whose response was lost before the local preview was updated.
    redacted_state = {
        "event": applied_state["event"],
        "document": {
            **applied_state["document"],
            "rawText": None,
            "rawJson": None,
            "parsedFields": None,
        },
    }
    current_snapshot = {
        "state": redacted_state,
        "fingerprint": plan["expectedAfterFingerprint"],
        "receipt": {
            "bodyHash": plan["bodyHash"],
            "bodyChars": plan["bodyChars"],
            "applied": True,
        },
    }
    preview["applied"] = False
    preview["appliedFingerprint"] = None

    async def rollback_after_lost_ack():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await repair.rollback_metadata_recovery(preview, "https://api.example", client)

    rollback = asyncio.run(rollback_after_lost_ack())
    assert current_snapshot["state"] == before
    assert current_snapshot["fingerprint"] == plan["beforeFingerprint"]
    assert rollback["fingerprint"] == plan["beforeFingerprint"]
    assert preview["applied"] is False
    assert preview["appliedFingerprint"] is None
    assert preview["rollbackFingerprint"] == plan["beforeFingerprint"]
    assert request_log[-2:] == [
        ("GET", f"/admin/news-receipts/{event_id}"),
        ("POST", f"/admin/news-receipts/{event_id}/rollback"),
    ]


def test_metadata_only_recovery_rejects_page_publication_date_mismatch():
    with pytest.raises(ValueError, match="did not confirm"):
        repair._verified_page_publication(
            '<time itemprop="datePublished" datetime="2026-10-22">October 22, 2026</time>',
            datetime(2026, 10, 21, 13, 26, tzinfo=UTC),
        )


def test_metadata_recovery_target_and_publisher_are_bound_to_existing_config(monkeypatch):
    monkeypatch.setattr(repair.audit, "_enabled", lambda: True)
    monkeypatch.setattr(repair.audit, "_api_base", lambda: "https://api.example/")
    assert repair._require_admin_target("https://api.example") == "https://api.example"
    with pytest.raises(ValueError, match="configured API"):
        repair._require_admin_target("https://attacker.example")
    assert repair._same_publisher(
        "https://www.publisher.example/story", "https://publisher.example/canonical"
    )
    assert not repair._same_publisher(
        "https://mirror.example/story", "https://publisher.example/canonical"
    )
