from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone

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
    monkeypatch.setattr(
        sys,
        "argv",
        ["repair", "--event-ids", original["id"], "--preview-file", str(preview)]
        + (["--apply"] if apply else []),
    )
    repair.main()
    assert json.loads(preview.read_text()) == repair.preview_payload([event])
    assert persisted == ([event] if apply else [])
