"""Intent/sentiment annotations with a deterministic first pass and optional HF.

The default path is intentionally rule-based: it is cheap, reproducible, and
safe to run in CI or edge-style Python workers. Hugging Face pipelines are a
second-pass enrichment for batch ingest when explicitly enabled.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Literal

from .lightweight_nlp import Intent, Sentiment, Urgency, annotate as annotate_lightweight

Method = Literal["rules-v1", "rules-v1+hf-sentiment", "rules-v1+hf-intent-sentiment"]

INTENT_LABELS: dict[Intent, str] = {
    "complaint": "customer complaint or user pain",
    "purchase-intent": "buyer evaluating or asking for recommendations",
    "feature-request": "request for a product feature or integration",
    "operational-risk": "business operation risk or process failure",
    "market-signal": "market or financial signal",
    "regional-pressure": "local or regional issue",
    "startup-validation": "startup validation or launch signal",
    "developer-workflow": "developer workflow or tooling issue",
    "general": "general discussion",
}

POSITIVE_SENTIMENT_LABELS = {"positive", "pos", "label_1"}
NEGATIVE_SENTIMENT_LABELS = {"negative", "neg", "label_0"}


@dataclass(frozen=True)
class SemanticNlpAnnotation:
    intent: Intent
    sentiment: Sentiment
    urgency: Urgency
    method: Method
    model_names: list[str] = field(default_factory=list)
    positive_hits: list[str] = field(default_factory=list)
    negative_hits: list[str] = field(default_factory=list)
    intent_hits: list[str] = field(default_factory=list)
    hf_intent_score: float | None = None
    hf_sentiment_score: float | None = None


@lru_cache(maxsize=1)
def _sentiment_pipeline() -> Any | None:
    model = os.environ.get(
        "HIGH_SIGNAL_HF_SENTIMENT_MODEL",
        "distilbert/distilbert-base-uncased-finetuned-sst-2-english",
    )
    try:
        from transformers import pipeline  # type: ignore

        return pipeline("sentiment-analysis", model=model, tokenizer=model)
    except Exception:
        return None


@lru_cache(maxsize=1)
def _zero_shot_pipeline() -> Any | None:
    model = os.environ.get("HIGH_SIGNAL_HF_INTENT_MODEL")
    if not model:
        return None
    try:
        from transformers import pipeline  # type: ignore

        return pipeline("zero-shot-classification", model=model, tokenizer=model)
    except Exception:
        return None


def _hf_sentiment(text: str) -> tuple[Sentiment | None, float | None, str | None]:
    pipe = _sentiment_pipeline()
    if pipe is None:
        return (None, None, None)
    try:
        out = pipe(text[:512])[0]
    except Exception:
        return (None, None, None)

    label = str(out.get("label", "")).lower()
    score = float(out.get("score", 0.0))
    model = os.environ.get(
        "HIGH_SIGNAL_HF_SENTIMENT_MODEL",
        "distilbert/distilbert-base-uncased-finetuned-sst-2-english",
    )
    if label in POSITIVE_SENTIMENT_LABELS:
        return ("positive", score, model)
    if label in NEGATIVE_SENTIMENT_LABELS:
        return ("negative", score, model)
    if "neutral" in label:
        return ("neutral", score, model)
    return (None, score, model)


def _hf_intent(text: str) -> tuple[Intent | None, float | None, str | None]:
    pipe = _zero_shot_pipeline()
    model = os.environ.get("HIGH_SIGNAL_HF_INTENT_MODEL")
    if pipe is None or not model:
        return (None, None, None)
    labels = list(INTENT_LABELS.values())
    try:
        out = pipe(text[:1200], candidate_labels=labels, multi_label=False)
    except Exception:
        return (None, None, model)

    best_label = str(out.get("labels", [""])[0])
    best_score = float(out.get("scores", [0.0])[0])
    reverse = {label: intent for intent, label in INTENT_LABELS.items()}
    return (reverse.get(best_label), best_score, model)


def annotate(text: str, *, use_hf: bool | None = None) -> SemanticNlpAnnotation:
    """Return stable NLP tags, optionally enriched by local/open HF pipelines.

    Set `HIGH_SIGNAL_ENABLE_HF_NLP=1` or pass `use_hf=True` to try Hugging Face
    inference. The call still falls back to rules if transformers/model loading
    fails, which keeps automation reliable.
    """

    base = annotate_lightweight(text)
    should_use_hf = use_hf if use_hf is not None else os.environ.get("HIGH_SIGNAL_ENABLE_HF_NLP") == "1"
    if not should_use_hf:
        return SemanticNlpAnnotation(
            intent=base.intent,
            sentiment=base.sentiment,
            urgency=base.urgency,
            method="rules-v1",
            positive_hits=base.positive_hits,
            negative_hits=base.negative_hits,
            intent_hits=base.intent_hits,
        )

    sentiment, sentiment_score, sentiment_model = _hf_sentiment(text)
    intent, intent_score, intent_model = _hf_intent(text)
    models = [model for model in (sentiment_model, intent_model) if model]
    method: Method = "rules-v1"
    if sentiment is not None:
        method = "rules-v1+hf-sentiment"
    if intent is not None:
        method = "rules-v1+hf-intent-sentiment"

    return SemanticNlpAnnotation(
        intent=intent if intent is not None and (intent_score or 0) >= 0.35 else base.intent,
        sentiment=sentiment if sentiment is not None and (sentiment_score or 0) >= 0.55 else base.sentiment,
        urgency=base.urgency,
        method=method,
        model_names=models,
        positive_hits=base.positive_hits,
        negative_hits=base.negative_hits,
        intent_hits=base.intent_hits,
        hf_intent_score=intent_score,
        hf_sentiment_score=sentiment_score,
    )
