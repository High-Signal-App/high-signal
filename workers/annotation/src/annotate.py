from __future__ import annotations

from dataclasses import asdict, dataclass
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
class Annotation:
    intent: Intent
    sentiment: Sentiment
    urgency: Urgency
    method: Literal["rules-v1"]
    model: Literal["none"]
    llm: Literal[False]
    intentScore: float
    sentimentScore: float
    positiveHits: list[str]
    negativeHits: list[str]
    intentHits: list[str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


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
        (
            "buy",
            "pay",
            "pricing",
            "budget",
            "vendor",
            "alternative",
            "recommend",
            "looking for",
            "switch",
            "worth it",
        ),
    ),
    (
        "feature-request",
        (
            "feature",
            "need",
            "wish",
            "missing",
            "request",
            "support for",
            "integration",
            "would like",
            "should add",
        ),
    ),
    (
        "operational-risk",
        (
            "cashflow",
            "payroll",
            "rent",
            "inventory",
            "fulfillment",
            "refund",
            "support",
            "chargeback",
            "outage",
            "delay",
        ),
    ),
    (
        "market-signal",
        (
            "stock",
            "market",
            "equity",
            "ipo",
            "guidance",
            "forecast",
            "demand",
            "capex",
            "margin",
            "revenue",
        ),
    ),
    (
        "regional-pressure",
        (
            "traffic",
            "pollution",
            "housing",
            "rent",
            "permit",
            "regulation",
            "tax",
            "city",
            "local",
            "commute",
        ),
    ),
    (
        "startup-validation",
        (
            "startup",
            "validate",
            "launch",
            "users",
            "waitlist",
            "distribution",
            "customer discovery",
            "mvp",
            "revenue",
        ),
    ),
    (
        "developer-workflow",
        (
            "github",
            "deploy",
            "debug",
            "ci",
            "workflow",
            "observability",
            "trace",
            "code review",
            "developer",
            "api",
        ),
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

URGENCY_TERMS = (
    "urgent",
    "immediately",
    "now",
    "deadline",
    "blocked",
    "can't",
    "cannot",
    "critical",
    "risk",
    "outage",
    "lawsuit",
)


def _hits(text: str, terms: tuple[str, ...]) -> list[str]:
    return [term for term in terms if term in text]


def _bounded_score(value: float) -> float:
    return max(0.0, min(1.0, round(value, 2)))


def annotate_text(text: str) -> Annotation:
    lower = text.lower()
    intent_scores = [
        (intent, hits)
        for intent, terms in INTENT_TERMS
        if (hits := _hits(lower, terms))
    ]
    intent_scores.sort(key=lambda item: len(item[1]), reverse=True)
    top_intent_hits = intent_scores[0][1] if intent_scores else []
    positive_hits = _hits(lower, POSITIVE_TERMS)
    negative_hits = _hits(lower, NEGATIVE_TERMS)
    urgent_hits = _hits(lower, URGENCY_TERMS)
    sentiment_hits = len(positive_hits) + len(negative_hits)

    if positive_hits and negative_hits:
        sentiment: Sentiment = "mixed"
    elif len(positive_hits) > len(negative_hits):
        sentiment = "positive"
    elif len(negative_hits) > len(positive_hits):
        sentiment = "negative"
    else:
        sentiment = "neutral"

    return Annotation(
        intent=intent_scores[0][0] if intent_scores else "general",
        sentiment=sentiment,
        urgency="high" if len(urgent_hits) >= 2 else "medium" if urgent_hits else "low",
        method="rules-v1",
        model="none",
        llm=False,
        intentScore=_bounded_score(len(top_intent_hits) / 3),
        sentimentScore=_bounded_score(
            abs(len(positive_hits) - len(negative_hits)) / max(1, sentiment_hits)
        ),
        positiveHits=positive_hits,
        negativeHits=negative_hits,
        intentHits=top_intent_hits,
    )
