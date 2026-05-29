"""Kalshi adapter — response parser tests (no network)."""

from __future__ import annotations

import pytest

from high_signal_ingest.sources.markets import (
    _kalshi_prob,
    _kalshi_market_url,
    parse_kalshi_market,
    parse_kalshi_response,
)


# ─── _kalshi_prob ─────────────────────────────────────────────────────────


def test_kalshi_prob_from_last_price_cents() -> None:
    # Kalshi prices are 0–100 cents; convert to 0–1 probability.
    assert _kalshi_prob({"last_price": 48}) == pytest.approx(0.48)
    assert _kalshi_prob({"last_price": 0}) == pytest.approx(0.0)
    assert _kalshi_prob({"last_price": 100}) == pytest.approx(1.0)


def test_kalshi_prob_from_yes_bid_ask_midpoint() -> None:
    # Falls back to yes_bid / yes_ask midpoint when last_price is missing.
    out = _kalshi_prob({"yes_bid": 47, "yes_ask": 49})
    assert out == pytest.approx(0.48)


def test_kalshi_prob_uses_last_price_over_midpoint() -> None:
    # last_price wins when both are present.
    out = _kalshi_prob({"last_price": 60, "yes_bid": 10, "yes_ask": 20})
    assert out == pytest.approx(0.60)


def test_kalshi_prob_missing_returns_none() -> None:
    assert _kalshi_prob({}) is None
    assert _kalshi_prob({"yes_bid": 50}) is None  # bid without ask
    assert _kalshi_prob({"last_price": None}) is None


def test_kalshi_prob_out_of_range_returns_none() -> None:
    # Defensive: if Kalshi ever returns a normalized 0–1 by mistake, treat
    # that as ambiguous and skip rather than misreport a 0.48% prob.
    assert _kalshi_prob({"last_price": -5}) is None
    assert _kalshi_prob({"last_price": 105}) is None


# ─── _kalshi_market_url ───────────────────────────────────────────────────


def test_kalshi_market_url() -> None:
    url = _kalshi_market_url("PRES-2028-WINNER-D")
    assert "kalshi.com" in url
    assert "PRES-2028-WINNER-D" in url


# ─── parse_kalshi_market ──────────────────────────────────────────────────


def _market_fixture(**overrides):
    base = {
        "ticker": "FED-DEC25-CUT",
        "event_ticker": "FED-DEC25",
        "title": "Fed cuts rates in December 2025",
        "subtitle": "FOMC December 2025 decision",
        "status": "open",
        "last_price": 64,
        "yes_bid": 63,
        "yes_ask": 65,
        "volume": 152_300,
        "volume_24h": 8_200,
    }
    base.update(overrides)
    return base


def test_parse_kalshi_market_basic() -> None:
    q = parse_kalshi_market(_market_fixture())
    assert q is not None
    assert q["source"] == "kalshi"
    assert q["marketId"] == "FED-DEC25-CUT"
    assert q["outcome"] == "yes"
    assert q["prob"] == pytest.approx(0.64)
    assert q["volume"] == pytest.approx(152_300)
    assert q["resolved"] is False
    assert "FED-DEC25-CUT" in q["marketUrl"]


def test_parse_kalshi_market_resolved() -> None:
    q = parse_kalshi_market(
        _market_fixture(status="settled", result="yes")
    )
    assert q is not None
    assert q["resolved"] is True
    assert q["resolvedOutcome"] == "yes"


def test_parse_kalshi_market_skips_no_prob() -> None:
    bad = _market_fixture(last_price=None, yes_bid=None, yes_ask=None)
    assert parse_kalshi_market(bad) is None


def test_parse_kalshi_market_skips_no_ticker() -> None:
    bad = _market_fixture(ticker="")
    assert parse_kalshi_market(bad) is None


def test_parse_kalshi_market_question_truncation() -> None:
    q = parse_kalshi_market(_market_fixture(title="x" * 600))
    assert q is not None
    assert len(q["question"]) <= 500


# ─── parse_kalshi_response ────────────────────────────────────────────────


def test_parse_kalshi_response_extracts_all_quotes() -> None:
    response = {
        "markets": [
            _market_fixture(ticker="A-1"),
            _market_fixture(ticker="A-2"),
            _market_fixture(ticker="A-3"),
        ],
        "cursor": "next-page",
    }
    quotes = parse_kalshi_response(response)
    assert len(quotes) == 3
    assert {q["marketId"] for q in quotes} == {"A-1", "A-2", "A-3"}


def test_parse_kalshi_response_skips_bad_entries() -> None:
    response = {
        "markets": [
            _market_fixture(ticker="GOOD"),
            _market_fixture(ticker=""),                  # no ticker → skip
            _market_fixture(ticker="NOPRICE", last_price=None, yes_bid=None, yes_ask=None),
        ],
    }
    quotes = parse_kalshi_response(response)
    assert [q["marketId"] for q in quotes] == ["GOOD"]


def test_parse_kalshi_response_empty() -> None:
    assert parse_kalshi_response({}) == []
    assert parse_kalshi_response({"markets": []}) == []
    assert parse_kalshi_response(None) == []  # type: ignore[arg-type]
