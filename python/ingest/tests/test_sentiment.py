from __future__ import annotations

import logging

from high_signal_ingest.score import sentiment


def test_score_empty_text_is_unavailable() -> None:
    result = sentiment.score("")

    assert result.available is False
    assert result.label == "neutral"
    assert result.confidence == 0.0
    assert result.reason == "empty_text"
    assert result.backend == "none"


def test_score_without_transformers_is_unavailable(monkeypatch) -> None:
    sentiment._UNAVAILABLE_LOGGED = False
    monkeypatch.setattr(sentiment, "_pipeline", lambda: None)

    result = sentiment.score("Revenue beat estimates and guidance was raised.")

    assert result.available is False
    assert result.label == "neutral"
    assert result.confidence == 0.0
    assert result.reason == "transformers_unavailable"
    assert result.backend == "none"


def test_score_without_transformers_logs_once(monkeypatch, caplog) -> None:
    sentiment._UNAVAILABLE_LOGGED = False
    monkeypatch.setattr(sentiment, "_pipeline", lambda: None)

    with caplog.at_level(logging.INFO, logger=sentiment.LOGGER.name):
        sentiment.score("first headline")
        sentiment.score("second headline")

    messages = [record.getMessage() for record in caplog.records if "FinBERT" in record.getMessage()]
    assert len(messages) == 1
    assert "unavailable" in messages[0]


def test_score_finbert_success_is_available(monkeypatch) -> None:
    monkeypatch.setattr(
        sentiment,
        "_pipeline",
        lambda: lambda _text: [{"label": "Positive", "score": 0.91}],
    )

    result = sentiment.score("Guidance raised on stronger datacenter demand.")

    assert result.available is True
    assert result.label == "positive"
    assert result.confidence == 0.91
    assert result.reason is None
    assert result.backend == "finbert"


def test_score_pipeline_failure_is_unavailable(monkeypatch) -> None:
    def boom(_text: str):
        raise RuntimeError("tokenizer failed")

    monkeypatch.setattr(sentiment, "_pipeline", lambda: boom)

    result = sentiment.score("A real headline that should have been scored.")

    assert result.available is False
    assert result.label == "neutral"
    assert result.confidence == 0.0
    assert result.reason == "pipeline_failed"
    assert result.backend == "none"
