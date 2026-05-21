"""Lightweight intent/sentiment tags without LLM calls.

This intentionally uses keyword features instead of large HF/PyTorch models so
it can run in cheap CI/edge contexts. Heavier Hugging Face model inference can
sit behind the same output shape later.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Intent = Literal[
    "complaint",
    "purchase-intent",
    "feature-request",
    "operational-risk",
    "market-signal",
    "regional-pressure",
    "startup-validation",
    "developer-workflow",
    "general",
]
Sentiment = Literal["positive", "negative", "neutral", "mixed"]
Urgency = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class LightweightNlpAnnotation:
    intent: Intent
    sentiment: Sentiment
    urgency: Urgency
    positive_hits: list[str]
    negative_hits: list[str]
    intent_hits: list[str]


INTENT_TERMS: list[tuple[Intent, tuple[str, ...]]] = [
    (
        "complaint",
        (
            "complaint",
            "problem",
            "broken",
            "frustrating",
            "annoying",
            "hate",
            "issue",
            "bug",
            "pain",
            "doesn't work",
            "not working",
        ),
    ),
    (
        "purchase-intent",
        ("buy", "pay", "pricing", "budget", "vendor", "alternative", "recommend", "looking for", "switch", "worth it"),
    ),
    (
        "feature-request",
        ("feature", "need", "wish", "missing", "request", "support for", "integration", "would like", "should add"),
    ),
    (
        "operational-risk",
        ("cashflow", "payroll", "rent", "inventory", "fulfillment", "refund", "support", "chargeback", "outage", "delay"),
    ),
    (
        "market-signal",
        ("stock", "market", "equity", "ipo", "guidance", "forecast", "demand", "capex", "margin", "revenue"),
    ),
    (
        "regional-pressure",
        ("traffic", "pollution", "housing", "rent", "permit", "regulation", "tax", "city", "local", "commute"),
    ),
    (
        "startup-validation",
        ("startup", "validate", "launch", "users", "waitlist", "distribution", "customer discovery", "mvp", "revenue"),
    ),
    (
        "developer-workflow",
        ("github", "deploy", "debug", "ci", "workflow", "observability", "trace", "code review", "developer", "api"),
    ),
]

POSITIVE_TERMS = (
    "good",
    "great",
    "better",
    "love",
    "works",
    "useful",
    "growth",
    "improve",
    "improved",
    "win",
    "wins",
    "surge",
    "strong",
    "profitable",
    "adoption",
)

NEGATIVE_TERMS = (
    "bad",
    "worse",
    "hate",
    "broken",
    "issue",
    "problem",
    "complaint",
    "decline",
    "delay",
    "risk",
    "lawsuit",
    "outage",
    "expensive",
    "struggling",
    "stagnation",
    "friction",
)

URGENCY_TERMS = ("urgent", "immediately", "now", "deadline", "blocked", "can't", "cannot", "critical", "risk", "outage", "lawsuit")


def _hits(text: str, terms: tuple[str, ...]) -> list[str]:
    return [term for term in terms if term in text]


def annotate(text: str) -> LightweightNlpAnnotation:
    lower = text.lower()
    intent_scores = [
        (intent, hits)
        for intent, terms in INTENT_TERMS
        if (hits := _hits(lower, terms))
    ]
    intent_scores.sort(key=lambda item: len(item[1]), reverse=True)
    positive_hits = _hits(lower, POSITIVE_TERMS)
    negative_hits = _hits(lower, NEGATIVE_TERMS)
    urgent_hits = _hits(lower, URGENCY_TERMS)
    if positive_hits and negative_hits:
        sentiment: Sentiment = "mixed"
    elif len(positive_hits) > len(negative_hits):
        sentiment = "positive"
    elif len(negative_hits) > len(positive_hits):
        sentiment = "negative"
    else:
        sentiment = "neutral"

    return LightweightNlpAnnotation(
        intent=intent_scores[0][0] if intent_scores else "general",
        sentiment=sentiment,
        urgency="high" if len(urgent_hits) >= 2 else "medium" if urgent_hits else "low",
        positive_hits=positive_hits,
        negative_hits=negative_hits,
        intent_hits=intent_scores[0][1] if intent_scores else [],
    )
