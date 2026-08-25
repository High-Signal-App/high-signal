"""Offline tests for the bounded-concurrency fetch orchestrator.

These never touch the network — every source adapter is monkeypatched. They
verify that `fetch()` fans out across sources, aggregates events, serialises
adapters that share a host, collects (rather than raises) per-source failures,
and honours the env-tunable caps.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.types import Event

# Every adapter module referenced by any pipeline source group.
ADAPTERS = [
    "edgar",
    "news",
    "reddit",
    "ir",
    "github",
    "github_archive",
    "gov",
    "huggingface",
    "youtube",
    "bluesky",
    "china_news",
    "scmp",
    "gdelt",
    "hkex",
    "cisa_kev",
    "lobsters",
    "substack",
    "techmeme",
    "package_registries",
    "jobs",
    "nvd",
    "guardian",
    "gov_contracts",
    "semantic_scholar",
    "regulations",
    "metaculus",
    "podcast_index",
    "macro_rates",
    "sec_xbrl",
    "legistar",
    "courtlistener",
    "openstates",
    "hackernews",
    "stackexchange",
    "eia",
    "producthunt",
    "coingecko",
    "google_trends",
    "appstore",
    "defillama",
    "bls",
    "appstore_reviews",
    "playstore_reviews",
    "us_gov_rss",
    "us_gov_api",
    "india_gov",
    "global_macro",
    "crypto_onchain",
    "ai_benchmarks",
    "dev_ecosystems",
]


def _event(source: str) -> Event:
    return Event(
        id=f"{source}-1",
        source=f"{source}:test",
        source_url=f"https://example.com/{source}",
        published_at=datetime(2026, 4, 25, tzinfo=timezone.utc),
        title=f"{source} headline",
        content="body",
        primary_entity_id="NVDA",
        raw_hash=source,
    )


def _stub_all(monkeypatch) -> None:
    """Make every adapter return a single event with no network access."""
    for name in ADAPTERS:
        mod = getattr(pipeline, name)
        monkeypatch.setattr(
            mod, "fetch_all", lambda *_a, _n=name, **_k: [_event(_n)], raising=False
        )
        # edgar / sec_xbrl use distinct entry points.
        if name == "edgar":
            monkeypatch.setattr(mod, "fetch_recent", lambda *_a, **_k: [_event("edgar")])
            monkeypatch.setattr(mod, "fetch_expanded", lambda *_a, **_k: [_event("edgar")])
    # markets returns (events, quotes) and has a push side-effect.
    monkeypatch.setattr(pipeline.markets, "fetch_all", lambda *_a, **_k: ([_event("markets")], []))
    monkeypatch.setattr(pipeline.markets, "push_quotes", lambda *_a, **_k: 0)
    # edgar entity load must not touch disk/network in a tight loop.
    monkeypatch.setattr(pipeline, "load_entities", lambda: [])


def test_fetch_all_runs_every_source_concurrently(monkeypatch) -> None:
    _stub_all(monkeypatch)
    failures: list[str] = []
    events = pipeline.fetch("all", days=1, failures=failures)
    # edgar with empty entities yields no event, but every other adapter does;
    # the key contract is "many sources ran and aggregated without error".
    assert len(events) >= 20
    assert failures == []


def test_fetch_collects_failures_without_raising(monkeypatch) -> None:
    _stub_all(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("429 rate limited")

    monkeypatch.setattr(pipeline.reddit, "fetch_all", boom)
    # Make retries instant so the test stays fast.
    monkeypatch.setenv("FETCH_RETRIES", "2")
    monkeypatch.setenv("FETCH_BACKOFF_BASE", "0")
    monkeypatch.setenv("FETCH_BACKOFF_CAP", "0")

    failures: list[str] = []
    events = pipeline.fetch("all", days=1, failures=failures)

    # The run still produced events from the healthy adapters...
    assert len(events) >= 20
    # ...and the flaky source is recorded, not raised.
    assert any(f.startswith("reddit:") and "429" in f for f in failures)


def test_fetch_records_one_receipt_per_scheduled_adapter(monkeypatch) -> None:
    _stub_all(monkeypatch)
    receipts: list[pipeline.FetchReceipt] = []

    pipeline.fetch("all", days=1, failures=[], receipts=receipts)

    names = {receipt.source for receipt in receipts}
    assert names == {name for name, _host, _fn in pipeline._fetch_tasks("all", 1)}
    assert "vc-portfolios" not in names
    assert all(receipt.finished_at >= receipt.started_at for receipt in receipts)


def test_failed_adapter_receipt_is_distinct_from_successful_empty(monkeypatch) -> None:
    _stub_all(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("429 rate limited")

    monkeypatch.setattr(pipeline.reddit, "fetch_all", boom)
    monkeypatch.setattr(pipeline.techmeme, "fetch_all", lambda *_a, **_k: [])
    monkeypatch.setenv("FETCH_RETRIES", "1")
    receipts: list[pipeline.FetchReceipt] = []

    pipeline.fetch("all", days=1, failures=[], receipts=receipts)

    by_source = {receipt.source: receipt for receipt in receipts}
    assert by_source["reddit"].errors == 1
    assert by_source["reddit"].events_fetched == 0
    assert by_source["techmeme"].errors == 0
    assert by_source["techmeme"].events_fetched == 0


def test_per_host_gate_serialises_same_host() -> None:
    """Two tasks for the same provider never overlap."""
    active = {"first": False, "second": False}
    overlap_seen = {"v": False}
    lock = threading.Lock()

    def make(name: str):
        def fn(*_a, **_k):
            with lock:
                active[name] = True
                if active["first"] and active["second"]:
                    overlap_seen["v"] = True
            time.sleep(0.02)
            with lock:
                active[name] = False
            return [_event(name)]

        return fn

    gate = pipeline._HostGate(per_host=1)
    first = threading.Thread(target=lambda: gate.run("sec.gov", make("first")))
    second = threading.Thread(target=lambda: gate.run("sec.gov", make("second")))
    first.start()
    second.start()
    first.join()
    second.join()
    assert overlap_seen["v"] is False


def test_group_selectors_match_catalog_membership() -> None:
    assert {name for name, _host, _fn in pipeline._fetch_tasks("all", 1)} == set(
        pipeline.source_catalog.DAILY_SOURCES
    )
    assert {name for name, _host, _fn in pipeline._fetch_tasks("context", 1)} == set(
        pipeline.source_catalog.CONTEXT_SOURCES
    )
    assert {name for name, _host, _fn in pipeline._fetch_tasks("weekly", 14)} == set(
        pipeline.source_catalog.WEEKLY_SOURCES
    )
    assert {name for name, _host, _fn in pipeline._fetch_tasks("monthly", 120)} == set(
        pipeline.source_catalog.MONTHLY_SOURCES
    )


def test_respects_edgar_ticker_limit(monkeypatch) -> None:
    _stub_all(monkeypatch)
    seen = {"n": None}

    def fake_recent(tickers, *_a, **_k):
        seen["n"] = len(tickers)
        return []

    monkeypatch.setattr(pipeline.edgar, "fetch_recent", fake_recent)
    monkeypatch.setattr(
        pipeline,
        "load_entities",
        lambda: [type("E", (), {"ticker": f"T{i}", "type": "public"})() for i in range(50)],
    )
    monkeypatch.setenv("EDGAR_TICKER_LIMIT", "5")

    pipeline.fetch("edgar", days=1, failures=[])
    assert seen["n"] == 5


def test_single_source_selection_runs_only_that_source(monkeypatch) -> None:
    _stub_all(monkeypatch)
    failures: list[str] = []
    events = pipeline.fetch("lobsters", days=3, failures=failures)
    assert [e.source for e in events] == ["lobsters:test"]
    assert failures == []


def test_fetch_only_persists_events_without_generating_candidates(monkeypatch) -> None:
    event = _event("crypto-onchain")
    monkeypatch.setattr(pipeline, "fetch", lambda *_a, **_k: [event])
    monkeypatch.setattr(pipeline.audit, "new_run_id", lambda: "run-1")
    monkeypatch.setattr(pipeline.audit, "push_events", lambda events, _run_id: len(events))
    recorded: list[dict] = []
    monkeypatch.setattr(
        pipeline.audit,
        "push_ingest_run",
        lambda **kwargs: recorded.append(kwargs),
    )
    monkeypatch.setattr(
        pipeline,
        "generate",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("generation must be skipped")),
    )

    result = pipeline.run("crypto-onchain", 1, generate_signals=False)

    assert result["events"] == 1
    assert result["signals_drafted"] == 0
    assert result["paths"] == []
    assert recorded[0]["notes"] == "fetch_run_id=run-1;mode=fetch_only"
