from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import sec_xbrl
from high_signal_ingest.stock_data import SourceRights, StockStore


def test_ticker_cik_map() -> None:
    assert sec_xbrl.ticker_cik_map({"0": {"ticker": "NVDA", "cik_str": 1045810}}) == {
        "NVDA": "0001045810"
    }


def test_event_from_companyfacts(tmp_path) -> None:
    payload = {
        "cik": 1045810,
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "units": {
                        "USD": [
                            {
                                "val": 100,
                                "filed": "2026-05-31",
                                "form": "10-Q",
                                "end": "2026-03-31",
                                "accn": "0001-26-000001",
                            }
                        ]
                    }
                },
                "NetIncomeLoss": {
                    "units": {
                        "USD": [
                            {
                                "val": 20,
                                "filed": "2026-05-31",
                                "form": "10-Q",
                                "end": "2026-03-31",
                                "accn": "0001-26-000001",
                            }
                        ]
                    }
                },
            }
        },
    }

    store = StockStore(tmp_path / "facts.sqlite")
    store.put_rights(
        SourceRights(
            "sec-xbrl",
            "https://example.org/test-licence",
            public_display="permitted",
            reviewed_at="2026-10-29T00:00:00Z",
        )
    )
    event = sec_xbrl.event_from_companyfacts(
        "NVDA",
        "NVDA",
        "0001045810",
        payload,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        store=store,
    )
    store.close()

    assert event is not None
    assert event.source == "sec-xbrl:nvda"
    assert event.primary_entity_id == "NVDA"
    assert "revenue: 100" in (event.content or "")


def test_pipeline_fetch_includes_sec_xbrl(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.sec_xbrl, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("sec-xbrl", days=1) == []
    assert calls == [120]
