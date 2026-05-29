"""Tier 1 derived fields from a sorted-ascending daily-close series.

All functions are pure. Inputs: ``Close`` objects with YYYYMMDD integer dates,
sorted ascending. Outputs: ``Tier1Snapshot`` with ``None`` for any field that
can't be computed from the available history.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional, Sequence


TRADING_DAYS_PER_YEAR = 252


@dataclass(frozen=True)
class Close:
    """One ticker × one day. ``date`` is YYYYMMDD integer."""

    date: int
    close: float
    volume: Optional[float] = None


@dataclass
class Tier1Snapshot:
    """Tier 1 derived fields. ``None`` means insufficient history."""

    ticker: str
    last_close: Optional[float] = None
    last_date: Optional[int] = None
    ret_1d: Optional[float] = None
    ret_30d: Optional[float] = None
    ret_90d: Optional[float] = None
    ret_1y: Optional[float] = None
    ret_5y: Optional[float] = None
    ret_1d_usd: Optional[float] = None
    ret_30d_usd: Optional[float] = None
    ret_90d_usd: Optional[float] = None
    ret_1y_usd: Optional[float] = None
    ret_5y_usd: Optional[float] = None
    volume_avg_30d: Optional[float] = None
    volatility_30d: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    dist_to_52w_high: Optional[float] = None
    dist_to_52w_low: Optional[float] = None
    max_drawdown_1y: Optional[float] = None
    max_drawdown_5y: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    golden_cross: bool = False
    death_cross: bool = False
    beta_vs_spy: Optional[float] = None
    rel_strength_spy_90d: Optional[float] = None


# ─── helpers ──────────────────────────────────────────────────────────────


def _yyyymmdd_to_date(d: int) -> date:
    return date(d // 10000, (d % 10000) // 100, d % 100)


def _date_to_yyyymmdd(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _find_close_at_or_before(closes: Sequence[Close], target_date: int) -> Optional[Close]:
    """Latest close with date <= target_date. Assumes closes sorted ascending."""
    if not closes:
        return None
    found: Optional[Close] = None
    for c in closes:
        if c.date <= target_date:
            found = c
        else:
            break
    return found


# ─── public compute functions ─────────────────────────────────────────────


def returns_over_window(closes: Sequence[Close], days_back: int) -> Optional[float]:
    """``(latest_close / close_at_or_before(latest_date - days_back)) - 1``.

    Calendar days, with nearest-prior trading day fallback. Returns ``None``
    when there's no close at or before the target date (insufficient history).
    """
    if len(closes) < 2:
        return None
    latest = closes[-1]
    target = _date_to_yyyymmdd(
        _yyyymmdd_to_date(latest.date) - timedelta(days=days_back)
    )
    if target < closes[0].date:
        return None
    prior = _find_close_at_or_before(closes, target)
    if prior is None or prior.date == latest.date or prior.close == 0:
        return None
    return latest.close / prior.close - 1


def volatility_annualized(closes: Sequence[Close], window: int = 30) -> Optional[float]:
    """Annualized stdev of daily returns over the last ``window`` trading days."""
    if len(closes) < window + 1:
        return None
    recent = closes[-(window + 1) :]
    daily_returns: list[float] = []
    for i in range(1, len(recent)):
        prev = recent[i - 1].close
        if prev == 0:
            return None
        daily_returns.append(recent[i].close / prev - 1)
    if len(daily_returns) < 2:
        return None
    return statistics.stdev(daily_returns) * math.sqrt(TRADING_DAYS_PER_YEAR)


def sma(closes: Sequence[Close], window: int) -> Optional[float]:
    """Simple moving average over the last ``window`` closes."""
    if len(closes) < window:
        return None
    recent = closes[-window:]
    return sum(c.close for c in recent) / window


def max_drawdown(closes: Sequence[Close]) -> Optional[float]:
    """Largest peak-to-trough drop as a negative number (e.g. -0.50 for 50% DD)."""
    if not closes:
        return None
    peak = closes[0].close
    mdd = 0.0
    for c in closes:
        if c.close > peak:
            peak = c.close
        if peak > 0:
            dd = c.close / peak - 1
            if dd < mdd:
                mdd = dd
    return mdd


def beta(
    asset_closes: Sequence[Close],
    bench_closes: Sequence[Close],
) -> Optional[float]:
    """Beta vs benchmark using overlapping daily returns.

    ``cov(asset_returns, bench_returns) / var(bench_returns)``
    """
    if len(asset_closes) < 2 or len(bench_closes) < 2:
        return None
    asset_by_date = {c.date: c.close for c in asset_closes}
    bench_by_date = {c.date: c.close for c in bench_closes}
    common_dates = sorted(set(asset_by_date) & set(bench_by_date))
    if len(common_dates) < 3:
        return None
    asset_rets: list[float] = []
    bench_rets: list[float] = []
    for i in range(1, len(common_dates)):
        d_prev = common_dates[i - 1]
        d_now = common_dates[i]
        a_prev = asset_by_date[d_prev]
        b_prev = bench_by_date[d_prev]
        if a_prev == 0 or b_prev == 0:
            continue
        asset_rets.append(asset_by_date[d_now] / a_prev - 1)
        bench_rets.append(bench_by_date[d_now] / b_prev - 1)
    if len(bench_rets) < 2:
        return None
    bench_var = statistics.variance(bench_rets)
    if bench_var == 0:
        return None
    n = len(asset_rets)
    asset_mean = sum(asset_rets) / n
    bench_mean = sum(bench_rets) / n
    cov = sum(
        (asset_rets[i] - asset_mean) * (bench_rets[i] - bench_mean) for i in range(n)
    ) / (n - 1)
    return cov / bench_var


def _detect_golden_cross(closes: Sequence[Close]) -> tuple[bool, bool]:
    """Returns ``(golden_state, death_state)`` based on SMA50 vs SMA200.

    Conventional reading: golden = SMA50 > SMA200, death = SMA50 < SMA200.
    Reported as current state; downstream readers can drill into recency
    via the underlying SMAs.
    """
    if len(closes) < 200:
        return False, False
    sma50_now = sma(closes, 50)
    sma200_now = sma(closes, 200)
    if sma50_now is None or sma200_now is None:
        return False, False
    return sma50_now > sma200_now, sma50_now < sma200_now


def _usd_return(
    closes: Sequence[Close],
    fx_to_usd_closes: Sequence[Close],
    days_back: int,
) -> Optional[float]:
    """USD-converted return: ``(close_now * fx_now) / (close_then * fx_then) - 1``."""
    if len(closes) < 2 or len(fx_to_usd_closes) < 2:
        return None
    latest_local = closes[-1]
    target = _date_to_yyyymmdd(
        _yyyymmdd_to_date(latest_local.date) - timedelta(days=days_back)
    )
    if target < closes[0].date:
        return None
    prior_local = _find_close_at_or_before(closes, target)
    if prior_local is None or prior_local.date == latest_local.date:
        return None
    fx_now = _find_close_at_or_before(fx_to_usd_closes, latest_local.date)
    fx_then = _find_close_at_or_before(fx_to_usd_closes, prior_local.date)
    if fx_now is None or fx_then is None or fx_then.close == 0:
        return None
    usd_now = latest_local.close * fx_now.close
    usd_then = prior_local.close * fx_then.close
    if usd_then == 0:
        return None
    return usd_now / usd_then - 1


def compute_tier1(
    ticker: str,
    closes: Sequence[Close],
    spy_closes: Optional[Sequence[Close]] = None,
    fx_to_usd_closes: Optional[Sequence[Close]] = None,
) -> Tier1Snapshot:
    """Build a ``Tier1Snapshot`` from a sorted-ascending closes series."""
    snap = Tier1Snapshot(ticker=ticker)
    if not closes:
        return snap

    latest = closes[-1]
    snap.last_close = latest.close
    snap.last_date = latest.date

    # Local-currency returns
    snap.ret_1d = returns_over_window(closes, 1)
    snap.ret_30d = returns_over_window(closes, 30)
    snap.ret_90d = returns_over_window(closes, 90)
    snap.ret_1y = returns_over_window(closes, 365)
    snap.ret_5y = returns_over_window(closes, 365 * 5)

    # USD-converted returns
    if fx_to_usd_closes:
        snap.ret_1d_usd = _usd_return(closes, fx_to_usd_closes, 1)
        snap.ret_30d_usd = _usd_return(closes, fx_to_usd_closes, 30)
        snap.ret_90d_usd = _usd_return(closes, fx_to_usd_closes, 90)
        snap.ret_1y_usd = _usd_return(closes, fx_to_usd_closes, 365)
        snap.ret_5y_usd = _usd_return(closes, fx_to_usd_closes, 365 * 5)
    else:
        # No FX provided → assume USD already
        snap.ret_1d_usd = snap.ret_1d
        snap.ret_30d_usd = snap.ret_30d
        snap.ret_90d_usd = snap.ret_90d
        snap.ret_1y_usd = snap.ret_1y
        snap.ret_5y_usd = snap.ret_5y

    # Volume average (last 30 closes)
    if len(closes) >= 30:
        recent = closes[-30:]
        volumes = [c.volume for c in recent if c.volume is not None]
        if volumes:
            snap.volume_avg_30d = sum(volumes) / len(volumes)

    # Volatility
    snap.volatility_30d = volatility_annualized(closes, 30)

    # 52-week (~252 trading days) high/low
    one_year_window = closes[-min(len(closes), 252):]
    if one_year_window:
        snap.high_52w = max(c.close for c in one_year_window)
        snap.low_52w = min(c.close for c in one_year_window)
        if snap.high_52w and snap.high_52w > 0:
            snap.dist_to_52w_high = latest.close / snap.high_52w - 1
        if snap.low_52w and snap.low_52w > 0:
            snap.dist_to_52w_low = latest.close / snap.low_52w - 1

    # Max drawdowns
    if len(closes) >= 252:
        snap.max_drawdown_1y = max_drawdown(closes[-252:])
    if len(closes) >= 252 * 5:
        snap.max_drawdown_5y = max_drawdown(closes[-(252 * 5):])

    # SMAs + golden/death cross
    snap.sma_50 = sma(closes, 50)
    snap.sma_200 = sma(closes, 200)
    snap.golden_cross, snap.death_cross = _detect_golden_cross(closes)

    # Beta vs SPY + relative strength
    if spy_closes is not None:
        snap.beta_vs_spy = beta(closes, spy_closes)
        spy_ret_90d = returns_over_window(spy_closes, 90)
        if snap.ret_90d is not None and spy_ret_90d is not None:
            snap.rel_strength_spy_90d = snap.ret_90d - spy_ret_90d

    return snap
