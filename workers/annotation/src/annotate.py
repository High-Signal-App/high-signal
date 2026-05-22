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
Audience = Literal[
    "agent-operators",
    "consumers",
    "developers",
    "general",
    "market-operators",
    "regional-public",
    "small-business-owners",
    "startup-builders",
]
RequirementType = Literal[
    "add-integration",
    "automate-workflow",
    "fix-bug",
    "improve-pricing",
    "local-ops",
    "monitor-market",
    "research-only",
    "validate-demand",
]
DecisionStage = Literal[
    "buyer-evaluation",
    "general-awareness",
    "market-monitoring",
    "pain-discovery",
    "solution-request",
    "world-change-watch",
]
QualityGateStatus = Literal["strong", "review", "weak"]
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
    audience: Audience
    requirementType: RequirementType
    decisionStage: DecisionStage
    opportunityScore: float
    qualityGate: dict[str, object]

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

INTEGRATION_TERMS = (
    "integration",
    "support for",
    "quickbooks",
    "shopify",
    "stripe",
    "api",
    "webhook",
)

AUTOMATION_TERMS = (
    "automate",
    "workflow",
    "dashboard",
    "template",
    "calculator",
    "checklist",
    "report",
)

PRICING_TERMS = (
    "pricing",
    "budget",
    "pay",
    "expensive",
    "worth it",
    "subscription",
    "trial",
)

BUG_TERMS = (
    "broken",
    "bug",
    "doesn't work",
    "not working",
    "outage",
    "blocked",
    "issue",
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


def _audience(domains: list[Domain]) -> Audience:
    if "agent-evaluation" in domains:
        return "agent-operators"
    if "developer" in domains:
        return "developers"
    if "small-business" in domains or "operations" in domains:
        return "small-business-owners"
    if "startup" in domains:
        return "startup-builders"
    if "regional" in domains:
        return "regional-public"
    if "market" in domains:
        return "market-operators"
    if "consumer" in domains:
        return "consumers"
    return "general"


def _requirement_type(
    intent: Intent,
    domains: list[Domain],
    integration_hits: list[str],
    automation_hits: list[str],
    pricing_hits: list[str],
    bug_hits: list[str],
) -> RequirementType:
    if intent == "market-signal" or "market" in domains:
        return "monitor-market"
    if intent == "regional-pressure" or "regional" in domains:
        return "local-ops"
    if intent == "startup-validation" or "startup" in domains:
        return "validate-demand"
    if integration_hits:
        return "add-integration"
    if bug_hits:
        return "fix-bug"
    if automation_hits:
        return "automate-workflow"
    if intent == "purchase-intent" or pricing_hits:
        return "improve-pricing"
    return "research-only"


def _decision_stage(intent: Intent, signal_layer: SignalLayer, pain_score: float) -> DecisionStage:
    if intent == "purchase-intent":
        return "buyer-evaluation"
    if intent == "feature-request":
        return "solution-request"
    if signal_layer == "market-watch":
        return "market-monitoring"
    if signal_layer == "world-change":
        return "world-change-watch"
    if pain_score > 0 or intent in ("complaint", "operational-risk"):
        return "pain-discovery"
    return "general-awareness"


def _quality_gate(
    pain_score: float,
    buyer_intent_score: float,
    actionability_score: float,
    urgency: Urgency,
    domains: list[Domain],
    product_requirement: bool,
) -> tuple[float, dict[str, object]]:
    domain_bonus = 0.08 if domains else 0.0
    urgency_bonus = 0.12 if urgency == "high" else 0.06 if urgency == "medium" else 0.0
    opportunity_score = _bounded_score(
        pain_score * 0.3
        + buyer_intent_score * 0.25
        + actionability_score * 0.3
        + domain_bonus
        + urgency_bonus
    )
    reasons: list[str] = []
    if product_requirement:
        reasons.append("product-requirement")
    if pain_score >= 0.34:
        reasons.append("pain")
    if buyer_intent_score >= 0.25:
        reasons.append("buyer-intent")
    if actionability_score >= 0.34:
        reasons.append("actionable")
    if domains:
        reasons.append("domain-tagged")
    if urgency != "low":
        reasons.append(f"{urgency}-urgency")
    if not reasons:
        reasons.append("weak-explicit-signal")
    status: QualityGateStatus = (
        "strong"
        if opportunity_score >= 0.7 and product_requirement
        else "review"
        if opportunity_score >= 0.38 or product_requirement
        else "weak"
    )
    return (
        opportunity_score,
        {
            "status": status,
            "score": round(opportunity_score * 100),
            "reasons": reasons,
        },
    )


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
    integration_hits = _hits(lower, INTEGRATION_TERMS)
    automation_hits = _hits(lower, AUTOMATION_TERMS)
    pricing_hits = _hits(lower, PRICING_TERMS)
    bug_hits = _hits(lower, BUG_TERMS)
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
    urgency: Urgency = "high" if len(urgent_hits) >= 2 else "medium" if urgent_hits else "low"
    signal_layer = _signal_layer(
        intent,
        market_hits,
        world_hits,
        pain_hits,
        actionability_hits,
    )
    domains = [domain for domain, _ in domain_scores[:4]]
    product_requirement = (
        pain_score >= 0.34
        or buyer_intent_score >= 0.25
        or actionability_score >= 0.34
    )
    opportunity_score, quality_gate = _quality_gate(
        pain_score,
        buyer_intent_score,
        actionability_score,
        urgency,
        domains,
        product_requirement,
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
        urgency=urgency,
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
        signalLayer=signal_layer,
        domains=domains,
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
        productRequirement=product_requirement,
        audience=_audience(domains),
        requirementType=_requirement_type(
            intent,
            domains,
            integration_hits,
            automation_hits,
            pricing_hits,
            bug_hits,
        ),
        decisionStage=_decision_stage(intent, signal_layer, pain_score),
        opportunityScore=opportunity_score,
        qualityGate=quality_gate,
    )
