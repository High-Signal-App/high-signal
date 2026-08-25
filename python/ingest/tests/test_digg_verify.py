from __future__ import annotations

from high_signal_ingest.digg_verify import (
    _allowed_original_url,
    discovery_query,
    title_alignment,
)


def test_title_alignment_requires_semantic_overlap() -> None:
    assert title_alignment(
        "Anthropic launches a new safety evaluation", "New Anthropic safety evaluation launches"
    ) >= 0.75
    assert title_alignment("Anthropic launches safety evaluation", "Apple updates iPhone camera") == 0


def test_discovery_query_drops_filler_words() -> None:
    query = discovery_query("The future of AI in the enterprise")
    assert "the" not in query.split()
    assert {"future", "enterprise"}.issubset(set(query.split()))


def test_attention_and_social_urls_are_never_original_evidence() -> None:
    assert _allowed_original_url("https://digg.com/tech/abc") is None
    assert _allowed_original_url("https://x.com/user/status/1") is None
    assert _allowed_original_url("https://reuters.com/technology/story") is not None
