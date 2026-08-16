"""FinBERT sentiment baseline — parked unless transformers is already installed.

`transformers` / FinBERT are not declared ingest dependencies. When the
pipeline is missing this module returns a typed unavailable result so callers
can tell it apart from a real FinBERT score. Do not treat
`("neutral", 0.0)` as a scored headline.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

LOGGER = logging.getLogger(__name__)

_UNAVAILABLE_LOGGED = False

Label = Literal["positive", "negative", "neutral"]
SentimentBackend = Literal["finbert", "none"]
SentimentReason = Literal["transformers_unavailable", "empty_text", "pipeline_failed"]


@dataclass(frozen=True)
class SentimentScore:
    label: Label
    confidence: float
    available: bool
    reason: SentimentReason | None
    backend: SentimentBackend


def _unavailable(reason: SentimentReason) -> SentimentScore:
    return SentimentScore(
        label="neutral",
        confidence=0.0,
        available=False,
        reason=reason,
        backend="none",
    )


def _log_unavailable_once() -> None:
    global _UNAVAILABLE_LOGGED
    if _UNAVAILABLE_LOGGED:
        return
    LOGGER.info(
        "FinBERT sentiment is unavailable (transformers not installed); "
        "returning an unscored neutral result"
    )
    _UNAVAILABLE_LOGGED = True


@lru_cache(maxsize=1)
def _pipeline():
    try:
        from transformers import pipeline  # type: ignore

        return pipeline(
            "sentiment-analysis",
            model="ProsusAI/finbert",
            tokenizer="ProsusAI/finbert",
        )
    except Exception:
        return None


def score(text: str) -> SentimentScore:
    """Return a typed sentiment result. `available` is True only for FinBERT."""
    if not text:
        return _unavailable("empty_text")
    p = _pipeline()
    if p is None:
        _log_unavailable_once()
        return _unavailable("transformers_unavailable")
    try:
        out = p(text[:512])[0]
        return SentimentScore(
            label=out["label"].lower(),  # type: ignore[arg-type]
            confidence=float(out["score"]),
            available=True,
            reason=None,
            backend="finbert",
        )
    except Exception:
        return _unavailable("pipeline_failed")
