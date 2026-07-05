"""Tests for the India D2C agent-visibility overlay (plan 0013, Slice 4)."""

from __future__ import annotations

from high_signal_ingest import d2c_agent_visibility as av
from high_signal_ingest.d2c_opportunities import NICHES


def test_build_prompt_is_open_ended() -> None:
    niche = NICHES[0]
    prompt = av.build_prompt(niche)
    assert "what are the best" in prompt.lower()
    assert niche.category in prompt
    assert niche.targetUser in prompt
    assert niche.problem in prompt


def test_extract_recommended_brands_numbered_list() -> None:
    text = (
        "Here are the top options:\n"
        "1. Mamaearth — affordable and widely available\n"
        "2. Plum — clean ingredients\n"
        "3. Minimalist — science-backed formulas\n"
    )
    brands = av.extract_recommended_brands(text)
    assert "Mamaearth" in brands
    assert "Plum" in brands
    assert "Minimalist" in brands


def test_extract_recommended_brands_bold_headers() -> None:
    text = "**Mamaearth** — affordable\n**Plum** — clean\n"
    brands = av.extract_recommended_brands(text)
    assert "Mamaearth" in brands
    assert "Plum" in brands


def test_extract_recommended_brands_empty_when_no_list() -> None:
    assert av.extract_recommended_brands("I don't know of any specific brands.") == []


def test_extract_recommended_brands_dedupes() -> None:
    text = "1. BrandA — reason\n2. BrandA — another reason\n"
    brands = av.extract_recommended_brands(text)
    assert brands == ["BrandA"]


def test_extract_cited_urls_dedupes_and_strips_punctuation() -> None:
    text = "See https://example.com/a and https://example.com/b. Also https://example.com/a again."
    urls = av.extract_cited_urls(text)
    assert urls == ["https://example.com/a", "https://example.com/b"]


def test_gap_score_monotonic_decreasing() -> None:
    scores = [av.gap_score(["x"] * n) for n in range(5)]
    for i in range(1, len(scores)):
        assert scores[i] <= scores[i - 1]


def test_gap_score_wide_open_when_no_brands() -> None:
    assert av.gap_score([]) == 1.0


def test_gap_score_saturated_when_4_plus() -> None:
    assert av.gap_score(["A", "B", "C", "D"]) == 0.0
    assert av.gap_score(["A", "B", "C", "D", "E"]) == 0.0


def test_no_impuls8_requests() -> None:
    """The agent-visibility runner must never call impuls8 endpoints."""
    import inspect

    src = inspect.getsource(av)
    # The word "impuls8" may appear in the docstring ("No impuls8 data") but
    # must never appear in a URL, host, or fetch call.
    assert "impuls8.com" not in src
    assert "impuls8.ai" not in src
    assert "api.impuls8" not in src
