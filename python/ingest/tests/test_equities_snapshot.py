"""Tier 1 snapshot compute — pure math on (date, close) series."""

from __future__ import annotations

import math
from datetime import date, timedelta

import pytest

from high_signal_ingest.sources.equities.snapshot import (
    Close,
    Tier1Snapshot,
    beta,
    compute_tier1,
    max_drawdown,
    returns_over_window,
    sma,
    volatility_annualized,
)


def _yyyymmdd(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _closes(start: date, prices: list[float], step_days: int = 1) -> list[Close]:
    """Build closes with explicit daily-or-stepped dates from ``start``."""
    return [
        Close(date=_yyyymmdd(start + timedelta(days=i * step_days)), close=p, volume=1000.0)
        for i, p in enumerate(prices)
    ]


# ─── returns_over_window ──────────────────────────────────────────────────


def test_returns_1d_basic() -> None:
    closes = _closes(date(2024, 1, 1), [100.0, 110.0])
    assert returns_over_window(closes, days_back=1) == pytest.approx(0.10)


def test_returns_finds_nearest_prior_trading_day() -> None:
    # Latest 2024-02-01 @ 200, target 30 days back = 2024-01-02.
    # No close on 2024-01-02; nearest prior is 2024-01-01 @ 100.
    closes = [
        Close(_yyyymmdd(date(2024, 1, 1)), 100.0),
        Close(_yyyymmdd(date(2024, 1, 15)), 150.0),
        Close(_yyyymmdd(date(2024, 2, 1)), 200.0),
    ]
    # 30 days back from 2024-02-01 = 2024-01-02 → nearest prior is 2024-01-01 (100).
    assert returns_over_window(closes, days_back=30) == pytest.approx(1.0)  # 200/100 - 1


def test_returns_insufficient_history() -> None:
    closes = _closes(date(2024, 1, 1), [100.0, 110.0, 120.0])  # 3 days only
    assert returns_over_window(closes, days_back=30) is None
    assert returns_over_window(closes, days_back=365) is None
    assert returns_over_window(closes, days_back=1825) is None


def test_returns_empty_series() -> None:
    assert returns_over_window([], days_back=1) is None


def test_returns_flat_series_is_zero() -> None:
    closes = _closes(date(2024, 1, 1), [100.0] * 400)
    assert returns_over_window(closes, days_back=1) == pytest.approx(0.0)
    assert returns_over_window(closes, days_back=30) == pytest.approx(0.0)
    assert returns_over_window(closes, days_back=365) == pytest.approx(0.0)


# ─── volatility_annualized ────────────────────────────────────────────────


def test_volatility_flat_series_is_zero() -> None:
    closes = _closes(date(2024, 1, 1), [100.0] * 60)
    assert volatility_annualized(closes, window=30) == pytest.approx(0.0)


def test_volatility_annualization_factor() -> None:
    # Build a series whose daily-return stdev is exactly 0.01.
    # Alternating +1%, -1% returns has stdev ≈ 0.01.
    prices = [100.0]
    for i in range(60):
        prices.append(prices[-1] * (1.01 if i % 2 == 0 else 1 / 1.01))
    closes = _closes(date(2024, 1, 1), prices)
    vol = volatility_annualized(closes, window=30)
    assert vol is not None
    # ~ 0.01 * sqrt(252) ≈ 0.1587
    assert 0.13 < vol < 0.20


def test_volatility_insufficient_history_returns_none() -> None:
    closes = _closes(date(2024, 1, 1), [100.0, 101.0, 99.0])
    assert volatility_annualized(closes, window=30) is None


# ─── sma ──────────────────────────────────────────────────────────────────


def test_sma_basic() -> None:
    closes = _closes(date(2024, 1, 1), [10.0, 20.0, 30.0, 40.0, 50.0])
    assert sma(closes, window=5) == pytest.approx(30.0)
    assert sma(closes, window=3) == pytest.approx(40.0)  # last 3: 30,40,50 → 40


def test_sma_insufficient_history_returns_none() -> None:
    closes = _closes(date(2024, 1, 1), [10.0, 20.0])
    assert sma(closes, window=5) is None


# ─── max_drawdown ─────────────────────────────────────────────────────────


def test_max_drawdown_synthetic_peak_then_trough() -> None:
    # 100 → 150 (peak) → 75 (trough) → 120
    closes = _closes(date(2024, 1, 1), [100.0, 150.0, 75.0, 120.0])
    # Peak 150, trough 75 → DD = (75-150)/150 = -0.5
    assert max_drawdown(closes) == pytest.approx(-0.5)


def test_max_drawdown_monotonic_up_is_zero() -> None:
    closes = _closes(date(2024, 1, 1), [10.0, 20.0, 30.0, 40.0, 50.0])
    assert max_drawdown(closes) == pytest.approx(0.0)


def test_max_drawdown_empty() -> None:
    assert max_drawdown([]) is None
    assert max_drawdown([Close(20240101, 100.0)]) == pytest.approx(0.0)


# ─── beta ──────────────────────────────────────────────────────────────────


def test_beta_against_self_is_one() -> None:
    closes = _closes(date(2024, 1, 1), [100.0 + i for i in range(260)])
    b = beta(closes, closes)
    assert b == pytest.approx(1.0, abs=1e-9)


def test_beta_against_inverse_is_negative_one() -> None:
    # Asset return = -benchmark return → beta = -1
    bench = _closes(date(2024, 1, 1), [100.0, 110.0, 99.0, 108.9, 98.01, 107.81])
    asset_prices = [100.0]
    for i in range(1, len(bench)):
        bench_ret = bench[i].close / bench[i - 1].close - 1
        asset_prices.append(asset_prices[-1] * (1 - bench_ret))
    asset = _closes(date(2024, 1, 1), asset_prices)
    b = beta(asset, bench)
    assert b == pytest.approx(-1.0, abs=1e-6)


def test_beta_no_overlap_returns_none() -> None:
    asset = _closes(date(2024, 1, 1), [100.0, 110.0])
    bench = _closes(date(2030, 1, 1), [100.0, 110.0])
    assert beta(asset, bench) is None


def test_beta_insufficient_data_returns_none() -> None:
    asset = _closes(date(2024, 1, 1), [100.0])
    bench = _closes(date(2024, 1, 1), [100.0])
    assert beta(asset, bench) is None


# ─── compute_tier1 (integration) ──────────────────────────────────────────


def test_compute_tier1_minimal() -> None:
    # 7 calendar years of daily flat closes → ret_* == 0, vol == 0, etc.
    # Fixture uses 1 calendar day per close, so we need 365*7 to span ret_5y.
    prices = [100.0] * (365 * 7)
    closes = _closes(date(2018, 1, 1), prices)
    snap = compute_tier1("FLAT", closes, spy_closes=closes)
    assert snap.ticker == "FLAT"
    assert snap.last_close == pytest.approx(100.0)
    assert snap.ret_1d == pytest.approx(0.0)
    assert snap.ret_30d == pytest.approx(0.0)
    assert snap.ret_5y == pytest.approx(0.0)
    assert snap.volatility_30d == pytest.approx(0.0)
    assert snap.max_drawdown_1y == pytest.approx(0.0)
    assert snap.sma_50 == pytest.approx(100.0)
    assert snap.sma_200 == pytest.approx(100.0)
    # Beta is undefined when both series have zero variance (flat). See the
    # test_beta_against_self_is_one case for the trending-identical scenario.
    assert snap.beta_vs_spy is None


def test_compute_tier1_short_history_nones_long_windows() -> None:
    # Only 60 days → ret_1y, ret_5y, sma_200, max_drawdown_5y should be None
    closes = _closes(date(2024, 1, 1), [100.0 + i for i in range(60)])
    snap = compute_tier1("SHORT", closes)
    assert snap.last_close == pytest.approx(159.0)
    assert snap.ret_1d is not None
    assert snap.ret_30d is not None
    assert snap.ret_1y is None
    assert snap.ret_5y is None
    assert snap.sma_200 is None
    assert snap.max_drawdown_5y is None


def test_compute_tier1_52w_high_low() -> None:
    # Climb then dip — high is the peak, low is the start.
    prices = [100.0, 120.0, 150.0, 200.0, 175.0, 160.0]
    closes = _closes(date(2024, 1, 1), prices)
    snap = compute_tier1("X", closes)
    assert snap.high_52w == pytest.approx(200.0)
    assert snap.low_52w == pytest.approx(100.0)
    assert snap.dist_to_52w_high == pytest.approx((160.0 - 200.0) / 200.0)
    assert snap.dist_to_52w_low == pytest.approx((160.0 - 100.0) / 100.0)


def test_compute_tier1_usd_returns_with_fx() -> None:
    # Foreign ticker, currency depreciates 50% over the window → USD return is worse.
    closes = _closes(date(2024, 1, 1), [100.0, 110.0])  # +10% local
    fx_closes = _closes(date(2024, 1, 1), [1.0, 0.5])   # currency halves vs USD
    snap = compute_tier1("FX", closes, fx_to_usd_closes=fx_closes)
    assert snap.ret_1d == pytest.approx(0.10)
    # USD: (110 * 0.5) / (100 * 1.0) - 1 = -0.45
    assert snap.ret_1d_usd == pytest.approx(-0.45)


def test_compute_tier1_usd_returns_default_to_local_when_no_fx() -> None:
    closes = _closes(date(2024, 1, 1), [100.0, 110.0])
    snap = compute_tier1("USD_TICKER", closes)
    # No FX provided → ret_*_usd should equal ret_* (treated as USD)
    assert snap.ret_1d_usd == snap.ret_1d


def test_compute_tier1_golden_cross_state() -> None:
    # Climb-then-flat: SMA50 should be above SMA200 once enough data has accumulated.
    prices = [50.0 + 0.5 * i for i in range(250)]  # steady climb
    closes = _closes(date(2024, 1, 1), prices)
    snap = compute_tier1("CLIMB", closes)
    assert snap.sma_50 is not None
    assert snap.sma_200 is not None
    # Recent 50d are above the older 200d on a steady climb
    assert snap.sma_50 > snap.sma_200
    # Either golden_cross or just-golden-state flag should be True
    assert snap.golden_cross is True


def test_compute_tier1_volume_avg() -> None:
    closes = [
        Close(_yyyymmdd(date(2024, 1, 1) + timedelta(days=i)), 100.0, volume=float(i + 1))
        for i in range(60)
    ]
    snap = compute_tier1("V", closes)
    # Last 30 days of volume: 31..60 → mean 45.5
    assert snap.volume_avg_30d == pytest.approx(45.5)


def test_compute_tier1_empty_closes() -> None:
    snap = compute_tier1("EMPTY", [])
    assert snap.ticker == "EMPTY"
    assert snap.last_close is None
    assert snap.ret_1d is None
    assert snap.sma_50 is None
    assert snap.volatility_30d is None
