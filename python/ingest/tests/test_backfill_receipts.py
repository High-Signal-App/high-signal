from __future__ import annotations

from datetime import datetime, timezone

import pytest

from high_signal_ingest import backfill, generator
from high_signal_ingest.types import Event, SourceDocument


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
