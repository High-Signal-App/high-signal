"""Forward-return backtest using the shared equities price adapter.

VectorBT is heavier; for v0 we use the repo's yfinance adapter and hand-roll
the math.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from high_signal_ingest.sources.equities.yf import fetch_closes

Outcome = Literal["hit", "miss", "push", "pending"]


def forward_return(ticker: str, published_at: datetime, window_days: int) -> float | None:
    """Return forward return % from `published_at` over `window_days` business days."""
    end = datetime.now(timezone.utc)
    target_end = published_at + timedelta(days=int(window_days * 1.6))  # buffer for weekends
    if target_end > end:
        return None
    try:
        closes = fetch_closes(
            ticker,
            start=published_at.date().isoformat(),
            end=target_end.date().isoformat(),
        )
        if len(closes) < 2:
            return None
        start_px = closes[0].close
        end_px = closes[min(window_days, len(closes) - 1)].close
        return (end_px / start_px - 1.0) * 100.0
    except Exception:
        return None


def classify(direction: str, ret_pct: float | None, push_band: float = 0.5) -> Outcome:
    if ret_pct is None:
        return "pending"
    if abs(ret_pct) < push_band:
        return "push"
    if direction == "up" and ret_pct > 0:
        return "hit"
    if direction == "down" and ret_pct < 0:
        return "hit"
    if direction == "neutral":
        return "push" if abs(ret_pct) < 2.0 else "miss"
    return "miss"
