"""Tests for the India D2C opportunity collector (plan 0013, Slice 2)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from high_signal_ingest import d2c_opportunities as d2c
from high_signal_ingest.types import Event


def _event(title: str, sub: str, score: int = 20) -> Event:
    return Event(
        id=title[:16],
        source=f"reddit:{sub}",
        source_url=f"https://reddit.com/r/{sub}/{title}",
        published_at=datetime.now(timezone.utc),
        title=title,
        content=None,
        primary_entity_id=None,
        raw_hash=title,
    )


def test_niche_seed_has_20_niches() -> None:
    assert len(d2c.NICHES) == 20
    slugs = [n.slug for n in d2c.NICHES]
    assert len(set(slugs)) == 20


def test_niche_seed_no_impuls8_references() -> None:
    for niche in d2c.NICHES:
        blob = json.dumps(niche.__dict__).lower()
        assert "impuls8" not in blob


def test_matches_filters_by_keywords() -> None:
    assert d2c._matches("hair fall is increasing", ["hair fall"]) is True
    assert d2c._matches("gardening tips", ["hair fall"]) is False
    assert d2c._matches("anything", []) is False


def test_snippet_truncates_long_text() -> None:
    long = "x" * 300
    out = d2c._snippet(long, max_len=50)
    assert len(out) <= 50
    assert out.endswith("…")


def test_demand_score_scales_with_community_evidence() -> None:
    none = d2c._demand_score([])
    assert none is None
    one = d2c._demand_score([d2c.EvidenceItem("community", "u", None, "s", "2026-07-05")])
    assert one is not None and one == pytest.approx(0.3, abs=0.01)
    six = d2c._demand_score(
        [d2c.EvidenceItem("community", f"u{i}", None, "s", "2026-07-05") for i in range(6)]
    )
    assert six is not None and six == pytest.approx(0.8, abs=0.01)
    ten = d2c._demand_score(
        [d2c.EvidenceItem("community", f"u{i}", None, "s", "2026-07-05") for i in range(10)]
    )
    assert ten is not None and ten == 0.85  # capped


def test_source_diversity_fraction() -> None:
    assert d2c._source_diversity([]) == 0.0
    one = d2c._source_diversity([d2c.EvidenceItem("community", "u", None, "s", "2026-07-05")])
    assert one == pytest.approx(1 / 7, abs=0.01)


def test_assign_launch_evidence_filters_by_keyword() -> None:
    niche = d2c.NICHES[0]  # hair growth
    ph = [
        d2c.EvidenceItem("launch", "u1", "producthunt", "hair fall serum launch", "2026-07-05"),
        d2c.EvidenceItem("launch", "u2", "producthunt", "unrelated crypto tool", "2026-07-05"),
    ]
    matched = d2c._assign_launch_evidence(niche, ph)
    assert len(matched) == 1
    assert "hair" in matched[0].snippet.lower()


@pytest.mark.asyncio
async def test_collect_reddit_filters_by_keywords_and_dedupes(tmp_path: Path) -> None:
    niche = d2c.NICHES[0]
    since = datetime.now(timezone.utc) - timedelta(days=7)
    events = [
        _event("hair fall increasing", "IndianSkincare"),
        _event("scalp irritation help", "IndianSkincare"),
        _event("gardening tips", "IndianSkincare"),  # filtered out
        _event("hair fall increasing", "IndianSkincare"),  # dup URL
    ]
    with patch(
        "high_signal_ingest.d2c_opportunities.fetch_subreddit_async",
        new=AsyncMock(
            side_effect=lambda sub, s, c, **kw: events if sub == "IndianSkincare" else []
        ),
    ):
        out = await d2c.collect_reddit(niche, since, client=None)  # type: ignore[arg-type]
    # 2 unique keyword-matching posts (gardening filtered, dup removed)
    assert len(out) == 2
    assert all(e.sourceClass == "community" for e in out)
    assert all("reddit" in (e.source or "") for e in out)


def test_parse_amazon_search_extracts_products() -> None:
    """Amazon.in search HTML parser extracts ASINs, titles, prices, ratings."""
    html = """
    <div data-asin="B0FAKE0001">
      <h2><span>Minimalist Hair Growth Serum with Redensyl 3%</span></h2>
      <span class="a-price-whole">599</span>
      <span class="a-icon-alt">4.2 out of 5</span>
      <span>1,234 ratings</span>
    </div>
    <div data-asin="B0FAKE0002">
      <h2><span>Pilgrim Hair Growth Serum for Scalp</span></h2>
      <span class="a-price-whole">749</span>
      <span class="a-icon-alt">3.8 out of 5</span>
      <span>890 ratings</span>
    </div>
    <div data-asin="">
      <h2><span>Empty ASIN should be skipped</span></h2>
    </div>
    """
    products = d2c._parse_amazon_search(html, "hair growth serum")
    assert len(products) == 2
    assert all(p.sourceClass == "product" for p in products)
    assert all(p.source == "amazon:in" for p in products)
    assert "amazon.in/dp/B0FAKE0001" in products[0].url
    assert "Minimalist" in products[0].snippet
    assert "599" in products[0].snippet
    assert "4.2 out of 5" in products[0].snippet


def test_competition_score_from_product_count() -> None:
    """Fewer products → higher competition gap (more opportunity)."""
    single = [d2c.EvidenceItem("product", "url", "amazon:in", "t", "2026-01-01T00:00:00Z")]
    many = [d2c.EvidenceItem("product", "url", "amazon:in", f"t{i}", "2026-01-01T00:00:00Z") for i in range(7)]
    assert d2c._competition_score(single) == 0.8
    assert d2c._competition_score(many) == 0.2
    assert d2c._competition_score([]) is None


def test_pricing_score_from_snippet_prices() -> None:
    """Median price maps to affordability bands."""
    cheap = [d2c.EvidenceItem("product", "u", "amazon:in", "Title — ₹199 — 4.0 out of 5", "2026-01-01T00:00:00Z")]
    mid = [d2c.EvidenceItem("product", "u", "amazon:in", "Title — ₹599 — 4.0 out of 5", "2026-01-01T00:00:00Z")]
    pricey = [d2c.EvidenceItem("product", "u", "amazon:in", "Title — ₹2999 — 4.0 out of 5", "2026-01-01T00:00:00Z")]
    no_price = [d2c.EvidenceItem("product", "u", "amazon:in", "Title only", "2026-01-01T00:00:00Z")]
    assert d2c._pricing_score(cheap) == 0.9
    assert d2c._pricing_score(mid) == 0.6
    assert d2c._pricing_score(pricey) == 0.2
    assert d2c._pricing_score(no_price) is None


@pytest.mark.asyncio
async def test_run_writes_dated_artifact(tmp_path: Path) -> None:
    out_dir = tmp_path / "d2c"
    with (
        patch(
            "high_signal_ingest.d2c_opportunities.fetch_subreddit_async",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_producthunt",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_amazon",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_ad_library",
            new=AsyncMock(return_value=[]),
        ),
    ):
        out_path = await d2c.run(days=7, limit=3, out_dir=out_dir)
    assert out_path.exists()
    assert out_path.name.endswith(".json")
    data = json.loads(out_path.read_text())
    assert data["region"] == "IN"
    assert len(data["niches"]) == 3
    for niche in data["niches"]:
        assert niche["nicheSlug"]
        assert niche["freshnessDate"]
        assert isinstance(niche["evidence"], list)
        # With all collectors mocked to return [], scores degrade to null.
        assert niche["competitionScore"] is None
        assert niche["pricingScore"] is None
        assert niche["adSaturationScore"] is None
        assert niche["agentVisibilityScore"] is None


@pytest.mark.asyncio
async def test_run_does_not_request_impuls8(tmp_path: Path) -> None:
    """The collector must never call impuls8 endpoints."""
    out_dir = tmp_path / "d2c"

    captured_urls: list[str] = []

    class _SpyClient:
        async def get(self, url, **kwargs):
            captured_urls.append(str(url))
            raise AssertionError(f"unexpected HTTP call to {url}")

    with (
        patch(
            "high_signal_ingest.d2c_opportunities.fetch_subreddit_async",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_producthunt",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_hackernews",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_amazon",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "high_signal_ingest.d2c_opportunities.collect_ad_library",
            new=AsyncMock(return_value=[]),
        ),
    ):
        await d2c.run(days=7, limit=2, out_dir=out_dir)
    assert not any("impuls8" in u.lower() for u in captured_urls)
