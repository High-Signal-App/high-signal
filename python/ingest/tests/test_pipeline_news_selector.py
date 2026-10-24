from __future__ import annotations

import argparse
import asyncio
import json

import pytest

from high_signal_ingest import pipeline
from high_signal_ingest.sources import news, registered_feeds


SOURCE = {
    "id": "test-publication",
    "type": "mailing_list",
    "tier": 3,
    "rss": "https://publisher.example.org/feed",
}


def test_source_parser_preserves_family_validation_and_rejects_unknown_publications(
    monkeypatch,
):
    monkeypatch.setattr(news, "load_sources", lambda: [SOURCE])
    for value in ["news", "all", "weekly", "ir", "news:test-publication"]:
        assert pipeline._parse_source(value) == value
    for value in [
        "newz",
        "news:",
        "news:not-configured",
        "news:test-publication,another",
    ]:
        with pytest.raises(argparse.ArgumentTypeError):
            pipeline._parse_source(value)


def test_publication_dispatch_is_bounded_and_keeps_exact_requested_lookback(
    monkeypatch,
):
    monkeypatch.setattr(news, "load_sources", lambda: [SOURCE])
    calls = []
    monkeypatch.setattr(news, "fetch_all", lambda **kwargs: calls.append(kwargs) or [])
    tasks = pipeline._fetch_tasks("news:test-publication", 28)
    assert len(tasks) == 1 and tasks[0][0] == "news:test-publication"
    assert tasks[0][2]() == []
    assert calls == [
        {
            "days": 28,
            "tier_max": 2,
            "fetch_body": True,
            "source_ids": ["test-publication"],
        }
    ]
    calls.clear()
    pipeline._fetch_tasks("news", 1)[0][2]()
    assert calls == [{"days": 1, "tier_max": 2, "fetch_body": True}]


def test_selected_paused_publication_records_explicit_no_fetch_without_other_sources(
    monkeypatch,
):
    monkeypatch.setattr(news, "load_sources", lambda: [SOURCE])
    monkeypatch.setattr(
        news.audit,
        "fetch_feed_sources",
        lambda: [{"id": "operator-row", "feedUrl": SOURCE["rss"], "enabled": False}],
    )
    receipts = []
    monkeypatch.setattr(news.audit, "push_ingest_runs", lambda rows: receipts.extend(rows) or True)

    async def unexpected_fetch(*_args, **_kwargs):
        raise AssertionError("A paused publication must never be fetched")

    monkeypatch.setattr(news, "_fetch_source", unexpected_fetch)
    assert asyncio.run(news.fetch_all_async(days=28, source_ids=["test-publication"])) == []
    assert len(receipts) == 1
    assert receipts[0]["source"] == "news:test-publication"
    assert receipts[0]["eventsFetched"] == 0 and receipts[0]["errors"] == 0
    assert json.loads(receipts[0]["notes"])["status"] == "not_selected"


def test_selected_publication_honors_operator_override_and_unknown_ids_fail(
    monkeypatch,
):
    monkeypatch.setattr(news, "load_sources", lambda: [SOURCE])
    monkeypatch.setattr(
        news.audit,
        "fetch_feed_sources",
        lambda: [
            {
                "id": SOURCE["id"],
                "feedUrl": "https://override.example.org/feed",
                "enabled": True,
            }
        ],
    )
    monkeypatch.setattr(news.audit, "push_ingest_runs", lambda _rows: True)
    seen = []

    async def collect(source, *_args, **_kwargs):
        seen.append(source)
        return []

    monkeypatch.setattr(news, "_fetch_source", collect)
    assert asyncio.run(news.fetch_all_async(source_ids=[SOURCE["id"]])) == []
    assert len(seen) == 1 and seen[0]["id"] == SOURCE["id"]
    assert seen[0]["rss"] == "https://override.example.org/feed"
    with pytest.raises(registered_feeds.PublicFeedFetchError, match="Unknown publication source"):
        asyncio.run(news.fetch_all_async(source_ids=["not-configured"]))
