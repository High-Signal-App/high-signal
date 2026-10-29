from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import sec_xbrl
from high_signal_ingest.stock_data import StockStore


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
    event = sec_xbrl.event_from_companyfacts(
        "NVDA",
        "NVDA",
        "0001045810",
        payload,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        store=store,
    )
    assert store.rights("sec-xbrl").allows("display")
    assert store.rights("sec-xbrl").allows("export")
    store.close()

    assert event is not None
    assert event.source == "sec-xbrl:nvda"
    assert event.primary_entity_id == "NVDA"
    assert "revenue: 100" in (event.content or "")


def test_pipeline_fetch_includes_sec_xbrl(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int, *, failures=None):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.sec_xbrl, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("sec-xbrl", days=1) == []
    assert calls == [120]


def test_mismatched_issuer_does_not_skip_remaining_issuers(monkeypatch):
    import httpx
    from types import SimpleNamespace
    from high_signal_ingest import seed
    from high_signal_ingest.stock_data_collectors import sec_xbrl as collector

    monkeypatch.setattr(
        seed,
        "load_entities",
        lambda: [
            SimpleNamespace(ticker=ticker, id=ticker, type="public") for ticker in ("NVDA", "AMD")
        ],
    )
    original_client = httpx.Client

    def response(request):
        if request.url.path.endswith("company_tickers.json"):
            return httpx.Response(
                200,
                json={"0": {"ticker": "NVDA", "cik_str": 1}, "1": {"ticker": "AMD", "cik_str": 2}},
            )
        return httpx.Response(200, json={"cik": 3})

    monkeypatch.setattr(
        collector.httpx,
        "Client",
        lambda **kwargs: original_client(transport=httpx.MockTransport(response), **kwargs),
    )
    calls = []

    def extract(ticker, *args):
        calls.append(ticker)
        if ticker == "NVDA":
            raise ValueError("issuer mismatch")
        return SimpleNamespace(id=ticker)

    monkeypatch.setattr(collector, "event_from_companyfacts", extract)
    failures = []
    events = collector.fetch_all(failures=failures)
    assert [event.id for event in events] == ["AMD"]
    assert calls == ["NVDA", "AMD"]
    assert len(failures) == 1 and "NVDA" in failures[0]
