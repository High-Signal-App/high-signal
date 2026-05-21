from __future__ import annotations

import re
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
Method = Literal["rules-v1", "semantic-rules-v2"]
SignalLayer = Literal["world-change", "app-complaint", "market-watch", "general"]
Domain = Literal[
    "agent-evaluation",
    "consumer",
    "developer",
    "market",
    "operations",
    "regional",
    "small-business",
    "startup",
]


@dataclass(frozen=True)
class Annotation:
    intent: Intent
    sentiment: Sentiment
    urgency: Urgency
    method: Method
    model: Literal["none"]
    llm: Literal[False]
    intentScore: float
    sentimentScore: float
    positiveHits: list[str]
    negativeHits: list[str]
    intentHits: list[str]
    signalLayer: SignalLayer
    domains: list[Domain]
    productSignals: list[str]
    painScore: float
    buyerIntentScore: float
    actionabilityScore: float
    productRequirement: bool

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
    "delays",
    "hurting",
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

WORLD_CHANGE_TERMS = (
    "announced",
    "launch",
    "regulation",
    "policy",
    "law",
    "tariff",
    "funding",
    "acquisition",
    "shutdown",
    "layoffs",
    "migration",
    "mandate",
)

PAIN_TERMS = (
    "problem",
    "broken",
    "frustrating",
    "annoying",
    "hate",
    "issue",
    "bug",
    "pain",
    "manual",
    "workaround",
    "expensive",
    "hurting",
    "blocked",
    "struggling",
)

BUYER_INTENT_TERMS = (
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
    "trial",
    "subscription",
)

ACTIONABILITY_TERMS = (
    "need",
    "missing",
    "should",
    "request",
    "support for",
    "integration",
    "automate",
    "dashboard",
    "template",
    "calculator",
    "api",
    "workflow",
    "checklist",
)

DOMAIN_TERMS: list[tuple[Domain, tuple[str, ...]]] = [
    (
        "agent-evaluation",
        (
            "agent",
            "llm",
            "ai search",
            "citation",
            "provenance",
            "retrieval",
            "mcp",
            "evaluation",
            "recommendation",
        ),
    ),
    (
        "consumer",
        (
            "consumer",
            "budget",
            "affordability",
            "jobs",
            "salary",
            "rent",
            "housing",
            "household",
        ),
    ),
    (
        "developer",
        (
            "github",
            "deploy",
            "debug",
            "ci",
            "code review",
            "developer",
            "api",
            "trace",
            "observability",
        ),
    ),
    (
        "market",
        (
            "stock",
            "market",
            "ipo",
            "guidance",
            "forecast",
            "capex",
            "margin",
            "revenue",
            "earnings",
        ),
    ),
    (
        "operations",
        (
            "cashflow",
            "payroll",
            "inventory",
            "fulfillment",
            "refund",
            "support",
            "chargeback",
            "outage",
        ),
    ),
    (
        "regional",
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
        "small-business",
        (
            "shopify",
            "etsy",
            "small business",
            "merchant",
            "seller",
            "freelance",
            "invoice",
            "checkout",
        ),
    ),
    (
        "startup",
        (
            "startup",
            "validate",
            "launch",
            "waitlist",
            "distribution",
            "customer discovery",
            "mvp",
            "founder",
        ),
    ),
]


def _hits(text: str, terms: tuple[str, ...]) -> list[str]:
    matches: list[str] = []
    for term in terms:
        if re.search(r"\s|['-]", term):
            if term in text:
                matches.append(term)
            continue
        if re.search(rf"\b{re.escape(term)}\b", text):
            matches.append(term)
    return matches


def _bounded_score(value: float) -> float:
    return max(0.0, min(1.0, round(value, 2)))


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out


def _signal_layer(
    intent: Intent,
    market_hits: list[str],
    world_hits: list[str],
    pain_hits: list[str],
    actionability_hits: list[str],
) -> SignalLayer:
    if intent == "market-signal" or len(market_hits) >= 2:
        return "market-watch"
    if len(world_hits) >= 2 and not pain_hits:
        return "world-change"
    if intent != "general" or pain_hits or actionability_hits:
        return "app-complaint"
    return "general"


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
    world_hits = _hits(lower, WORLD_CHANGE_TERMS)
    pain_hits = _hits(lower, PAIN_TERMS)
    buyer_intent_hits = _hits(lower, BUYER_INTENT_TERMS)
    actionability_hits = _hits(lower, ACTIONABILITY_TERMS)
    domain_scores = [
        (domain, hits)
        for domain, terms in DOMAIN_TERMS
        if (hits := _hits(lower, terms))
    ]
    domain_scores.sort(key=lambda item: (-len(item[1]), item[0]))
    market_hits = next((hits for domain, hits in domain_scores if domain == "market"), [])
    sentiment_hits = len(positive_hits) + len(negative_hits)
    intent = intent_scores[0][0] if intent_scores else "general"
    pain_score = _bounded_score((len(pain_hits) + len(negative_hits)) / 6)
    buyer_intent_score = _bounded_score(len(buyer_intent_hits) / 4)
    actionability_score = _bounded_score(
        (len(actionability_hits) + len(top_intent_hits)) / 6
    )

    if positive_hits and negative_hits:
        sentiment: Sentiment = "mixed"
    elif len(positive_hits) > len(negative_hits):
        sentiment = "positive"
    elif len(negative_hits) > len(positive_hits):
        sentiment = "negative"
    else:
        sentiment = "neutral"

    return Annotation(
        intent=intent,
        sentiment=sentiment,
        urgency="high" if len(urgent_hits) >= 2 else "medium" if urgent_hits else "low",
        method="semantic-rules-v2",
        model="none",
        llm=False,
        intentScore=_bounded_score(len(top_intent_hits) / 3),
        sentimentScore=_bounded_score(
            abs(len(positive_hits) - len(negative_hits)) / max(1, sentiment_hits)
        ),
        positiveHits=positive_hits,
        negativeHits=negative_hits,
        intentHits=top_intent_hits,
        signalLayer=_signal_layer(
            intent,
            market_hits,
            world_hits,
            pain_hits,
            actionability_hits,
        ),
        domains=[domain for domain, _ in domain_scores[:4]],
        productSignals=_unique(
            top_intent_hits
            + pain_hits
            + buyer_intent_hits
            + actionability_hits
            + world_hits
        )[:10],
        painScore=pain_score,
        buyerIntentScore=buyer_intent_score,
        actionabilityScore=actionability_score,
        productRequirement=(
            pain_score >= 0.34
            or buyer_intent_score >= 0.25
            or actionability_score >= 0.34
        ),
    )
