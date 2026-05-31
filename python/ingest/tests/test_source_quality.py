from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest.source_quality import summarize
from high_signal_ingest.types import Event


def test_summarize_reports_mapping_yield() -> None:
    rows = summarize(
        "fixture",
        [
            Event(
                id="1",
                source="cisa-kev",
                source_url="https://example.com/1",
                published_at=datetime(2026, 5, 31, tzinfo=timezone.utc),
                title="Microsoft Defender CVE",
                content="CVE",
                primary_entity_id="MSFT",
                raw_hash="1",
            ),
            Event(
                id="2",
                source="lobsters",
                source_url="https://example.com/2",
                published_at=datetime(2026, 5, 31, tzinfo=timezone.utc),
                title="Unmapped technical thread",
                content=None,
                primary_entity_id=None,
                raw_hash="2",
            ),
        ],
    )

    assert rows.events == 2
    assert rows.mapped_events == 1
    assert rows.unmapped_events == 1
    assert rows.mapping_rate == 0.5
    assert rows.mapped_entities == {"MSFT": 1}
    assert rows.unmapped_samples == ["Unmapped technical thread"]
