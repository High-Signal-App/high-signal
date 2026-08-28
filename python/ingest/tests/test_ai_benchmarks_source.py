from __future__ import annotations

import httpx

from high_signal_ingest.sources import ai_benchmarks


class FakeResponse:
    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


def _get(url: str, **kwargs: object) -> FakeResponse:
    if url == ai_benchmarks.LMSYS_API_URL:
        return FakeResponse(
            {
                "meta": {
                    "fetched_at": "2026-08-28T08:00:00Z",
                    "source_url": "https://arena.ai/leaderboard/",
                },
                "models": [
                    {
                        "rank": 1,
                        "model": "model-a",
                        "vendor": "Example AI",
                        "score": 1400,
                        "ci": 5,
                        "votes": 1000,
                    },
                    {
                        "rank": 2,
                        "model": "model-b",
                        "vendor": "Other AI",
                        "score": 1380,
                        "ci": 6,
                        "votes": 900,
                    },
                ],
            }
        )
    if url == ai_benchmarks.ARTIFICIAL_ANALYSIS_API_URL:
        return FakeResponse(
            {
                "data": [
                    {
                        "slug": "model-b",
                        "name": "Model B",
                        "model_creator": {"name": "Other AI"},
                        "evaluations": {
                            "artificial_analysis_intelligence_index": 51.2,
                            "artificial_analysis_coding_index": 45,
                        },
                        "pricing": {
                            "price_1m_input_tokens": 2,
                            "price_1m_output_tokens": 8,
                        },
                        "performance": {"median_output_tokens_per_second": 90},
                    },
                    {
                        "slug": "model-a",
                        "name": "Model A",
                        "model_creator": {"name": "Example AI"},
                        "evaluations": {
                            "artificial_analysis_intelligence_index": 60.5,
                            "artificial_analysis_coding_index": 55,
                        },
                        "pricing": {
                            "price_1m_input_tokens": 3,
                            "price_1m_output_tokens": 12,
                        },
                        "performance": {"median_output_tokens_per_second": 80},
                    },
                ]
            }
        )
    if url == ai_benchmarks.OPENROUTER_RANKINGS_URL:
        return FakeResponse(
            {
                "data": [
                    {
                        "date": "2026-08-27",
                        "model_permaslug": "old-model",
                        "total_tokens": 999,
                        "prompt_tokens": 600,
                        "completion_tokens": 399,
                    },
                    {
                        "date": "2026-08-28",
                        "model_permaslug": "other",
                        "total_tokens": 999999,
                    },
                    {
                        "date": "2026-08-28",
                        "model_permaslug": "example/model-a",
                        "total_tokens": 1500000,
                        "prompt_tokens": 1000000,
                        "completion_tokens": 500000,
                    },
                ]
            }
        )
    raise AssertionError(f"unexpected GET {url} kwargs={kwargs}")


def test_fetch_all_builds_three_leaderboard_snapshots(monkeypatch) -> None:
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(ai_benchmarks.httpx, "get", _get)

    events = ai_benchmarks.fetch_all(days=2)

    assert {event.source for event in events} == {
        "ai-benchmarks:lmsys",
        "ai-benchmarks:artificial-analysis",
        "ai-benchmarks:openrouter",
    }
    assert "model-a" in events[0].title
    assert "Model A" in events[1].title
    assert "1,500,000 tokens" in events[2].title
    assert all(event.content and "|" in event.content for event in events)


def test_keyed_benchmarks_skip_without_credentials(monkeypatch) -> None:
    monkeypatch.delenv("ARTIFICIAL_ANALYSIS_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    assert ai_benchmarks._fetch_artificial_analysis() == []
    assert ai_benchmarks._fetch_openrouter() == []


def test_benchmark_fetchers_fail_closed(monkeypatch) -> None:
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def fail(*args: object, **kwargs: object) -> FakeResponse:
        raise httpx.ConnectError("offline fixture")

    monkeypatch.setattr(ai_benchmarks.httpx, "get", fail)

    assert ai_benchmarks._fetch_lmsys() == []
    assert ai_benchmarks._fetch_artificial_analysis() == []
    assert ai_benchmarks._fetch_openrouter() == []


def test_benchmark_helpers_reject_invalid_dates_and_format_tables() -> None:
    assert ai_benchmarks._parse_datetime(None) is None
    assert ai_benchmarks._parse_datetime("invalid") is None
    assert ai_benchmarks._parse_datetime("2026-08-28").isoformat().endswith("+00:00")
    assert ai_benchmarks._format_table(["A"], [["B"]]) == "| A |\n|---|\n| B |"
