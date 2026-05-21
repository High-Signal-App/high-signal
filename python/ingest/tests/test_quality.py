from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest.quality import assess_signal_quality
from high_signal_ingest.types import EvidenceItem, SignalCandidate


def _candidate(
    *,
    evidence_urls: list[str],
    body: str = "This signal has enough explanation to describe what changed, why it matters, who is affected, and what evidence supports the read. It also links the evidence in plain language so the card is auditable by a reader.",
    signal_type: str = "partnership",
    confidence: str = "medium",
) -> SignalCandidate:
    return SignalCandidate(
        slug="nvda-test",
        signal_type=signal_type,
        primary_entity_id="NVDA",
        direction="up",
        confidence=confidence,  # type: ignore[arg-type]
        predicted_window_days=30,
        published_at=datetime(2026, 5, 21, tzinfo=timezone.utc),
        evidence=[
            EvidenceItem(url=url, source_type="web", excerpt=None, published_at=None)
            for url in evidence_urls
        ],
        spillover_entity_ids=[],
        body_md=body,
    )


def test_quality_publishes_two_independent_sources() -> None:
    q = assess_signal_quality(
        _candidate(
            evidence_urls=[
                "https://www.reuters.com/technology/nvidia-test",
                "https://www.sec.gov/Archives/edgar/data/test",
            ]
        )
    )

    assert q.publishable is True
    assert q.score >= 65
    assert "official" in q.source_classes


def test_quality_keeps_single_non_official_source_as_draft() -> None:
    q = assess_signal_quality(_candidate(evidence_urls=["https://example.com/post"]))

    assert q.publishable is False
    assert "single_non_official_source" in q.reasons


def test_quality_allows_explicit_prediction_market_probability_item() -> None:
    q = assess_signal_quality(
        _candidate(
            evidence_urls=["https://manifold.markets/user/will-this-happen"],
            signal_type="domestic_euv_development_probability",
            confidence="low",
            body="Prediction market probability item with clear market framing and enough explanation about why this is only a low-confidence market-pulse read for future monitoring.",
        )
    )

    assert q.publishable is True
    assert q.content_category == "market-pulse"


def test_quality_blocks_fallback_body() -> None:
    q = assess_signal_quality(
        _candidate(
            evidence_urls=[
                "https://www.reuters.com/technology/nvidia-test",
                "https://www.sec.gov/Archives/edgar/data/test",
            ],
            body="Fallback draft generated from 2 source(s) because normal LLM generation did not return a publishable candidate.",
        )
    )

    assert q.publishable is False
    assert "fallback_or_backfill" in q.reasons
