"""Forward-return scoring from retained canonical prices; never a market-data fetcher."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from high_signal_ingest.stock_data.store import StockStore
from high_signal_ingest.stock_data_prices import stock_store_path

Outcome = Literal["hit", "miss", "push", "pending"]


def forward_return(ticker: str, published_at: datetime, window_days: int) -> float | None:
    """Return forward return % from `published_at` over `window_days` business days."""
    end = datetime.now(timezone.utc)
    if window_days < 1 or published_at > end:
        return None
    target_end = min(end, published_at + timedelta(days=window_days * 2 + 14))
    try:
        path = stock_store_path()
        if not path.exists():
            return None
        canonical = (
            ticker
            if "." in ticker or ticker.startswith("^") or "-USD" in ticker
            else f"{ticker}.US"
        )
        with StockStore(path) as store:
            closes = store.historical_closes(
                canonical, published_at.date().isoformat(), target_end.isoformat()
            )
        if len(closes) <= window_days:
            return None
        first_date = datetime.strptime(str(closes[0]["date"]), "%Y%m%d").replace(
            tzinfo=timezone.utc
        )
        if first_date.date() > (published_at + timedelta(days=7)).date():
            return None
        start_px = closes[0]["close"]
        end_px = closes[window_days]["close"]
        if start_px <= 0:
            return None
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
