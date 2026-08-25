from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import macro_rates


def test_ecb_events_from_xml() -> None:
    xml = """<?xml version="1.0"?>
    <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
      xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
      <Cube><Cube time="2026-05-31"><Cube currency="USD" rate="1.08"/></Cube></Cube>
    </gesmes:Envelope>
    """

    events = macro_rates.ecb_events_from_xml(xml)

    assert len(events) == 1
    assert events[0].source == "macro-rates:ecb-fx"
    assert "EUR/USD=1.08" in (events[0].content or "")


def test_fred_events_from_csv() -> None:
    csv_text = "date,value\n2026-05-31,4.25\n"

    events = macro_rates.fred_events_from_csv(
        "DGS10",
        csv_text,
        datetime(2026, 5, 1, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "macro-rates:fred:dgs10"
    assert events[0].title == "FRED DGS10: 4.25"


def test_fred_events_accepts_bare_carriage_return_csv() -> None:
    events = macro_rates.fred_events_from_csv(
        "DGS3MO",
        "date,value\r2026-05-31,4.10\r",
        datetime(2026, 5, 1, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].title == "FRED DGS3MO: 4.10"


def test_pipeline_fetch_includes_macro_rates(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.macro_rates, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("macro-rates", days=1) == []
    assert calls == [30]
