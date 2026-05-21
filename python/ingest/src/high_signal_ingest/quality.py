"""Deterministic signal quality gates shared by writer/pipeline.

The LLM can synthesize a candidate, but publication should be decided by
evidence shape: source count, independence, source class, and whether the item
is explicitly framed as a market-probability read.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

from .types import Confidence, SignalCandidate

SourceClass = Literal["official", "news", "community", "market", "developer", "regional", "review", "other"]
QualityBand = Literal["strong", "usable", "watch", "draft"]
ContentCategory = Literal[
    "ai-infra",
    "market-pulse",
    "product-opportunity",
    "customer-complaint",
    "startup-move",
    "regional-issue",
    "agent-evaluation",
    "policy-regulatory",
    "company-event",
]


@dataclass(frozen=True)
class SignalQuality:
    score: int
    band: QualityBand
    content_category: ContentCategory
    evidence_count: int
    independent_source_count: int
    source_classes: list[SourceClass]
    publishable: bool
    reasons: list[str]


OFFICIAL_DOMAINS = (
    "sec.gov",
    "investor.",
    "ir.",
    "newsroom.",
    "prnewswire.com",
    "businesswire.com",
    "gov",
    "europa.eu",
    "federalregister.gov",
    "hkexnews.hk",
)
NEWS_DOMAINS = (
    "reuters.com",
    "bloomberg.com",
    "wsj.com",
    "ft.com",
    "cnbc.com",
    "theinformation.com",
    "digitimes.com",
    "eetimes.com",
    "trendforce.com",
    "tomshardware.com",
    "nextplatform.com",
    "semianalysis.com",
    "servethehome.com",
)
MARKET_DOMAINS = ("manifold.markets", "polymarket.com", "kalshi.com", "finance.yahoo.com")
COMMUNITY_DOMAINS = ("reddit.com", "news.ycombinator.com", "producthunt.com")
DEVELOPER_DOMAINS = ("github.com", "github.blog", "developers.google.com", "cloudflare.com", "stripe.com")
REVIEW_DOMAINS = ("g2.com", "capterra.com", "trustpilot.com", "apps.shopify.com")
REGIONAL_DOMAINS = ("timesofindia.indiatimes.com", "thehindu.com", "livemint.com", "indianexpress.com")


def _clean(value: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "_" for ch in value)
    while "__" in out:
        out = out.replace("__", "_")
    return out


def source_domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or url).removeprefix("www.").lower()
    except Exception:
        return url.lower()


def _has_domain(domain: str, needles: tuple[str, ...]) -> bool:
    return any(domain == needle or needle in domain for needle in needles)


def classify_source(url: str) -> SourceClass:
    domain = source_domain(url)
    if _has_domain(domain, OFFICIAL_DOMAINS):
        return "official"
    if _has_domain(domain, MARKET_DOMAINS):
        return "market"
    if _has_domain(domain, COMMUNITY_DOMAINS):
        return "community"
    if _has_domain(domain, DEVELOPER_DOMAINS):
        return "developer"
    if _has_domain(domain, REVIEW_DOMAINS):
        return "review"
    if _has_domain(domain, REGIONAL_DOMAINS):
        return "regional"
    if _has_domain(domain, NEWS_DOMAINS):
        return "news"
    return "other"


def classify_content_category(signal_type: str, body_md: str) -> ContentCategory:
    text = f"{_clean(signal_type)} {_clean(body_md[:1200])}"
    rules: list[tuple[ContentCategory, tuple[str, ...]]] = [
        ("market-pulse", ("market", "prediction", "probability", "quote", "stock", "equity", "ipo", "analyst")),
        ("customer-complaint", ("complaint", "review", "churn", "support", "refund", "bug", "missing", "friction")),
        ("product-opportunity", ("product", "launch", "developer", "workflow", "requirement", "adoption", "integration")),
        ("startup-move", ("startup", "funding", "m_and_a", "acquisition", "partnership", "talent", "hiring")),
        ("regional-issue", ("regional", "india", "china", "taiwan", "korea", "eu", "local", "city")),
        ("agent-evaluation", ("agent", "llm", "ai_answer", "retrievability", "comparison", "evidence_layer")),
        ("policy-regulatory", ("regulatory", "policy", "export", "restriction", "antitrust", "lawsuit", "probe", "gov")),
    ]
    for category, terms in rules:
        if any(_clean(term) in text for term in terms):
            return category
    if any(term in text for term in ("hbm", "gpu", "chip", "semiconductor", "foundry", "substrate", "litho", "euv", "packaging", "capex", "datacenter", "data_center", "neocloud", "memory", "asic")):
        return "ai-infra"
    return "company-event"


def _fallback_or_backfill(body_md: str) -> bool:
    body = body_md.lstrip().lower()
    return "fallback draft generated" in body or body.startswith("> _backfill_")


def _explicit_market_probability(signal_type: str, body_md: str, source_classes: list[SourceClass]) -> bool:
    text = _clean(f"{signal_type} {body_md[:800]}")
    return bool(source_classes) and all(s == "market" for s in source_classes) and (
        "prediction" in text or "probability" in text or "market" in text
    )


def _confidence_points(confidence: Confidence) -> int:
    if confidence == "high":
        return 14
    if confidence == "medium":
        return 10
    return 5


def assess_signal_quality(candidate: SignalCandidate) -> SignalQuality:
    urls = list(dict.fromkeys(e.url for e in candidate.evidence if e.url))
    domains = {source_domain(url) for url in urls}
    source_classes = list(dict.fromkeys(classify_source(url) for url in urls))
    official = "official" in source_classes
    market_only = len(source_classes) == 1 and source_classes[0] == "market"
    fallback = _fallback_or_backfill(candidate.body_md)
    explicit_market = _explicit_market_probability(candidate.signal_type, candidate.body_md, source_classes)
    reasons: list[str] = []

    score = 0
    score += min(len(urls), 3) * 18
    score += min(len(domains), 3) * 16
    if official:
        score += 20
    if len(source_classes) >= 2:
        score += 12
    if len(candidate.body_md.strip()) >= 280:
        score += 8
    score += _confidence_points(candidate.confidence)
    if explicit_market:
        score += 8

    if fallback:
        score -= 50
        reasons.append("fallback_or_backfill")
    if not urls:
        score -= 50
        reasons.append("missing_evidence")
    if len(urls) == 1 and not official and not explicit_market:
        score -= 25
        reasons.append("single_non_official_source")
    if market_only and not explicit_market:
        score -= 35
        reasons.append("market_only_without_probability_frame")
    if candidate.confidence != "low" and len(domains) < 2 and not official:
        score -= 25
        reasons.append("medium_high_without_independent_sources")

    score = max(0, min(100, round(score)))
    publishable = not fallback and (score >= 65 or (explicit_market and score >= 45))
    if score >= 85:
        band: QualityBand = "strong"
    elif publishable:
        band = "usable"
    elif score >= 45:
        band = "watch"
    else:
        band = "draft"
    if publishable:
        reasons.append("passes_publish_gate")

    return SignalQuality(
        score=score,
        band=band,
        content_category=classify_content_category(candidate.signal_type, candidate.body_md),
        evidence_count=len(urls),
        independent_source_count=len(domains),
        source_classes=source_classes,
        publishable=publishable,
        reasons=reasons,
    )
