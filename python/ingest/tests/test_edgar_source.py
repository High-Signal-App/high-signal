from __future__ import annotations

from datetime import datetime, timedelta, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import edgar


def test_form_d_events_from_search_response() -> None:
    payload = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        "form": "D",
                        "file_date": "2026-05-15",
                        "adsh": "0002134995-26-000001",
                        "ciks": ["0002134995"],
                        "display_names": ["OpenAI-01, a Series of OpenAI Opp Fund LLC"],
                        "biz_locations": ["New York, NY"],
                        "items": ["06B", "3C"],
                    }
                }
            ]
        }
    }

    events = edgar.form_d_events_from_search(
        "OpenAI",
        payload,
        datetime(2026, 5, 1, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "edgar_d"
    assert events[0].title == "SEC Form D: OpenAI-01, a Series of OpenAI Opp Fund LLC"
    assert "000213499526000001" in events[0].source_url


def test_pipeline_uses_expanded_edgar_for_wide_windows(monkeypatch) -> None:
    calls: list[tuple[list[str], int]] = []
    monkeypatch.setattr(
        pipeline,
        "load_entities",
        lambda: [
            type("Entity", (), {"ticker": "NVDA", "type": "public"})(),
            type("Entity", (), {"ticker": None, "type": "private"})(),
        ],
    )

    def fake_fetch_expanded(tickers: list[str], days: int):
        calls.append((tickers, days))
        return []

    monkeypatch.setattr(pipeline.edgar, "fetch_expanded", fake_fetch_expanded)

    assert pipeline.fetch("edgar", days=30) == []
    assert calls == [(["NVDA"], 30)]


def test_daily_window_keeps_day_granular_filing_dates(monkeypatch) -> None:
    """EDGAR stamps filings at day granularity, so the cutoff must be a date.

    Regression: the 02:30 UTC cron tick ran `days=1`, giving
    `since = yesterday 02:30`. Every filing dated yesterday carries
    `00:00` and so fell *before* the cutoff, as did every filing dated today.
    Daily EDGAR could therefore never return a filing — production shows zero
    `edgar` events ever persisted with `runStatus: success_empty`.
    """

    class _Filing:
        def __init__(self, filing_date: str) -> None:
            self.filing_date = filing_date
            self.filing_url = f"https://www.sec.gov/Archives/{filing_date}"

        def text(self) -> str:
            return "body"

    class _Company:
        def __init__(self, _ticker: str) -> None:
            pass

        def get_filings(self, form: str):  # noqa: ARG002
            return [_Filing("2026-08-29"), _Filing("2026-08-30"), _Filing("2026-08-20")]

    import edgar as edgar_pkg

    monkeypatch.setattr(edgar_pkg, "Company", _Company)
    monkeypatch.setattr(edgar, "_ensure_identity", lambda: None)

    # The exact shape of the daily cron: dispatched at 02:30 UTC with days=1.
    since = datetime(2026, 8, 30, 2, 30, tzinfo=timezone.utc) - timedelta(days=1)
    events = list(edgar.fetch_filings(["NVDA"], since, forms=("8-K",)))

    dates = sorted(e.published_at.date().isoformat() for e in events)
    assert dates == ["2026-08-29", "2026-08-30"]
    # The filing from ten days ago stays outside a one-day window.
    assert "2026-08-20" not in dates


def test_form_d_window_is_also_day_granular() -> None:
    payload = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        "form": "D",
                        "file_date": "2026-05-01",
                        "adsh": "0002134995-26-000001",
                        "ciks": ["0002134995"],
                        "display_names": ["Anthropic PBC"],
                    }
                }
            ]
        }
    }
    since = datetime(2026, 5, 1, 2, 30, tzinfo=timezone.utc)
    assert len(edgar.form_d_events_from_search("Anthropic", payload, since)) == 1
