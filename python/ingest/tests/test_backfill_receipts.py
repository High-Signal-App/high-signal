from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from high_signal_ingest import backfill, generator
from high_signal_ingest.types import Event, SourceDocument
from high_signal_ingest.writer import SignalDeliveryError


def _event() -> Event:
    return Event(
        id="event-1",
        source="news:test",
        source_url="https://example.com/event-1",
        published_at=datetime(2026, 4, 25, tzinfo=timezone.utc),
        title="NVIDIA capacity changed",
        content="NVIDIA capacity changed.",
        primary_entity_id="NVDA",
        raw_hash="event-1",
        source_document=SourceDocument(document_key="news:test:event-1"),
    )


@pytest.mark.parametrize("receipt, expected_drafted", [(None, 0), ("pushed:bf-nvda", 1)])
def test_backfill_counts_only_emission_receipts(monkeypatch, receipt, expected_drafted) -> None:
    event = _event()
    candidate = generator.fallback_candidate("NVDA", [event], [])
    assert candidate is not None

    monkeypatch.setattr(backfill, "fetch_historical", lambda *_args: [event])
    monkeypatch.setattr(backfill.audit, "new_run_id", lambda: "run-1")
    monkeypatch.setattr(backfill.audit, "push_events", lambda *_args: 1)
    monkeypatch.setattr(backfill.audit, "push_ingest_run", lambda **_kwargs: None)
    monkeypatch.setattr(backfill, "generate", lambda *_args: candidate)
    monkeypatch.setattr(backfill, "emit", lambda _candidate: receipt)

    result = backfill.run(
        datetime(2026, 4, 25, tzinfo=timezone.utc),
        datetime(2026, 4, 26, tzinfo=timezone.utc),
        ["test"],
    )

    assert result["drafted"] == expected_drafted


def test_backfill_accounts_delivery_failures_without_fallback(monkeypatch) -> None:
    event = _event()
    candidate = generator.fallback_candidate("NVDA", [event], [])
    assert candidate is not None
    audit_call: dict = {}

    monkeypatch.setattr(backfill, "fetch_historical", lambda *_args: [event])
    monkeypatch.setattr(backfill.audit, "new_run_id", lambda: "run-mixed")
    monkeypatch.setattr(backfill.audit, "push_events", lambda *_args: 1)
    monkeypatch.setattr(
        backfill.audit, "push_ingest_run", lambda **kwargs: audit_call.update(kwargs)
    )
    monkeypatch.setattr(backfill, "generate", lambda *_args: candidate)
    receipts = iter(
        [
            "pushed:bf-nvda",
            SignalDeliveryError(
                "bf-nvda-2", "HTTP 503", Path("signal-recovery/2026-04-25/bf-nvda-2.md")
            ),
            None,
        ]
    )

    def emit_side_effect(_candidate):
        receipt = next(receipts)
        if isinstance(receipt, Exception):
            raise receipt
        return receipt

    monkeypatch.setattr(backfill, "emit", emit_side_effect)
    monkeypatch.setattr(
        backfill,
        "fallback_candidate",
        lambda *_args: pytest.fail("delivery failure invoked fallback"),
    )

    # Three independent entities exercise success, typed failure and protected skip.
    monkeypatch.setattr(
        backfill,
        "fetch_historical",
        lambda *_args: [
            event,
            event.model_copy(update={"id": "event-2", "primary_entity_id": "AAPL"}),
            event.model_copy(update={"id": "event-3", "primary_entity_id": "MSFT"}),
        ],
    )
    result = backfill.run(
        datetime(2026, 4, 25, tzinfo=timezone.utc),
        datetime(2026, 4, 26, tzinfo=timezone.utc),
        ["test"],
    )

    assert result["drafted"] == 1
    assert result["errors"] == 1
    assert result["signals_delivery_failed"] == 1
    assert result["signals_recovered"] == 1
    assert result["recovery_paths"] == ["signal-recovery/2026-04-25/bf-nvda-2.md"]
    assert audit_call["errors"] == 1
    assert "signal delivery failed" in audit_call["error_sample"]
    assert "signals_delivery_failed=1" in audit_call["notes"]


def test_backfill_cli_returns_four_on_delivery_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        backfill,
        "run",
        lambda *_args, **_kwargs: {"signals_delivery_failed": 1},
    )
    monkeypatch.setattr(
        "sys.argv",
        ["backfill", "--start", "2026-04-25", "--end", "2026-04-26"],
    )

    with pytest.raises(SystemExit) as exc_info:
        backfill.main()
    assert exc_info.value.code == 4
