from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import stackexchange


def test_events_from_response_parses_question() -> None:
    payload = {
        "items": [
            {
                "question_id": 999,
                "title": "How to serve a PyTorch model with &lt;1ms latency?",
                "creation_date": int(datetime(2026, 6, 20, tzinfo=timezone.utc).timestamp()),
                "score": 5,
                "answer_count": 2,
                "view_count": 300,
                "tags": ["pytorch", "cuda"],
                "link": "https://stackoverflow.com/q/999",
            }
        ]
    }
    events = stackexchange.events_from_response("pytorch", payload, datetime(2026, 6, 1, tzinfo=timezone.utc))
    assert len(events) == 1
    ev = events[0]
    assert ev.source == "stackexchange"
    assert ev.source_url == "https://stackoverflow.com/q/999"
    assert "<1ms" in ev.title  # html-unescaped
    assert "pytorch" in (ev.content or "")


def test_events_from_response_drops_below_min_score() -> None:
    payload = {"items": [{"question_id": 1, "title": "q", "creation_date": int(datetime(2026, 6, 20, tzinfo=timezone.utc).timestamp()), "score": 0}]}
    assert stackexchange.events_from_response("pytorch", payload, datetime(2026, 6, 1, tzinfo=timezone.utc)) == []


def test_pipeline_fetch_includes_stackexchange(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(pipeline.stackexchange, "fetch_all", lambda days: calls.append(days) or [])
    assert pipeline.fetch("stackexchange", days=1) == []
    assert calls == [30]
