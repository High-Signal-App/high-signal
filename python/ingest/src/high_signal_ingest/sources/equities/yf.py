"""yfinance adapter — daily closes for equities, indices, and crypto.

Replaces the original Stooq adapter after Stooq locked their free CSV
endpoint behind a captcha-issued API key (May 2026). yfinance is already
in the project's deps and provides global coverage via Yahoo Finance,
with batch download support that's ~10× faster than per-ticker.

Pure helpers (``ticker_to_yfinance_symbol``, ``_dataframe_to_closes``)
are unit-tested without network. Fetchers are thin wrappers around
``yf.Ticker.history`` / ``yf.download``.
"""

from __future__ import annotations

import logging
import math
import os
import random
import signal
import time
from typing import Iterable, Optional

import pandas as pd
import yfinance as yf

from .snapshot import Close


LOGGER = logging.getLogger(__name__)


# Bounded retry for the batch downloader. Reuses the full-jitter discipline
# from pipeline._with_backoff so a transient Yahoo 429/5xx does not abort the
# whole universe-wide snapshot. Env-overridable for ops tuning.
_YF_BATCH_RETRIES = int(os.environ.get("YF_BATCH_RETRIES", "2"))
_YF_BATCH_BACKOFF_BASE = float(os.environ.get("YF_BATCH_BACKOFF_BASE", "1.0"))
_YF_BATCH_BACKOFF_CAP = float(os.environ.get("YF_BATCH_BACKOFF_CAP", "8.0"))
# Per-batch wall-clock timeout (seconds). yf.download has no native timeout, so
# we enforce one via SIGALRM on the main thread (the download runs synchronously
# here). Set to 0 to disable the alarm (tests / non-POSIX).
_YF_BATCH_TIMEOUT = float(os.environ.get("YF_BATCH_TIMEOUT", "90"))


class _YfBatchTimeout(Exception):
    """Raised when a yf.download batch exceeds the wall-clock timeout."""


def _alarm_handler(signum: int, frame: object) -> None:  # noqa: ARG001
    raise _YfBatchTimeout("yf.download exceeded per-batch timeout")


# Map our canonical exchange suffixes → yfinance's Yahoo-style suffixes.
# US: yfinance uses bare symbols (no suffix). Crypto: "-USD" already in ticker.
# Indices: yfinance uses the caret form (^GSPC etc.), same as our canonical.
_EXCHANGE_TO_YF_SUFFIX: dict[str, str] = {
    "US": "",
    "L": ".L",
    "PA": ".PA",
    "DE": ".DE",
    "AS": ".AS",
    "BR": ".BR",
    "MI": ".MI",
    "MC": ".MC",
    "SW": ".SW",
    "ST": ".ST",
    "CO": ".CO",
    "OL": ".OL",
    "HE": ".HE",
    "VI": ".VI",
    "WA": ".WA",
    "IR": ".IR",     # Ireland (Euronext Dublin)
    "JP": ".T",      # Tokyo: 7203.JP → 7203.T
    "T": ".T",       # already in yfinance form
    "HK": ".HK",
    "SS": ".SS",     # Shanghai
    "SZ": ".SZ",     # Shenzhen
    "TO": ".TO",     # Toronto
    "V": ".V",       # TSX Venture
    "AX": ".AX",     # ASX
    "NS": ".NS",     # NSE India
    "BO": ".BO",     # BSE India
    "KS": ".KS",     # KRX
    "KQ": ".KQ",     # KOSDAQ
    "SA": ".SA",     # B3 Brazil
    "MX": ".MX",
    "IS": ".IS",     # Istanbul
    "JO": ".JO",     # JSE
    "CRYPTO": "-USD",
}


def ticker_to_yfinance_symbol(ticker: str) -> str:
    """Convert our canonical ticker → yfinance/Yahoo symbol form.

    - Indices (``^GSPC``) pass through unchanged.
    - Crypto (``BTC-USD``) passes through unchanged.
    - US equities/ETFs (``AAPL.US``) drop the ``.US`` suffix.
    - International tickers (``7203.JP``) map suffix per ``_EXCHANGE_TO_YF_SUFFIX``.
    """
    if not ticker:
        return ticker
    if ticker.startswith("^"):
        return ticker
    if "-USD" in ticker:
        return ticker
    if "." in ticker:
        symbol, ext = ticker.rsplit(".", 1)
        suffix = _EXCHANGE_TO_YF_SUFFIX.get(ext.upper())
        if suffix is None:
            # Unknown — pass through original form; yfinance may still resolve.
            return ticker
        return f"{symbol}{suffix}"
    return ticker


def _dataframe_to_closes(df: Optional[pd.DataFrame]) -> list[Close]:
    """Convert a yfinance OHLCV DataFrame → list[Close], sorted ascending by date."""
    if df is None or df.empty:
        return []
    if "Close" not in df.columns:
        return []
    rows: list[Close] = []
    for idx, row in df.iterrows():
        close_val = row.get("Close")
        try:
            close_f = float(close_val)
        except (TypeError, ValueError):
            continue
        if math.isnan(close_f):
            continue
        # Normalize the index to a YYYYMMDD int.
        if hasattr(idx, "year"):
            d = int(idx.year) * 10000 + int(idx.month) * 100 + int(idx.day)
        else:
            ts = pd.Timestamp(idx)
            d = ts.year * 10000 + ts.month * 100 + ts.day
        vol_raw = row.get("Volume") if "Volume" in row.index else None
        try:
            if vol_raw is None:
                volume: Optional[float] = None
            else:
                vol_f = float(vol_raw)
                volume = None if math.isnan(vol_f) else vol_f
        except (TypeError, ValueError):
            volume = None
        rows.append(Close(date=d, close=close_f, volume=volume))
    rows.sort(key=lambda r: r.date)
    return rows


# ─── fetchers ─────────────────────────────────────────────────────────────


def fetch_closes(
    ticker: str,
    period: str = "6y",
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> list[Close]:
    """Fetch daily closes for a single ticker.

    Uses ``auto_adjust=True`` for split-and-dividend-adjusted closes (the
    right default for return calculations).
    """
    yf_symbol = ticker_to_yfinance_symbol(ticker)
    try:
        t = yf.Ticker(yf_symbol)
        if start:
            df = t.history(start=start, end=end, auto_adjust=True)
        else:
            df = t.history(period=period, auto_adjust=True)
        return _dataframe_to_closes(df)
    except Exception as exc:  # noqa: BLE001 — yfinance raises many types
        LOGGER.warning("yfinance %s (%s) error: %s", ticker, yf_symbol, exc)
        return []


def _download_batch(
    yf_symbols: list[str],
    period: str,
) -> Optional[pd.DataFrame]:
    """Run one ``yf.download`` batch with a per-batch timeout and bounded retry.

    Timeout is enforced via SIGALRM (POSIX only; on non-POSIX or when
    ``_YF_BATCH_TIMEOUT <= 0`` the alarm is skipped and the call is unbounded —
    the same as the prior behavior). Retry uses full-jitter backoff identical
    to ``pipeline._with_backoff`` so a single flaky Yahoo response does not
    abort the universe-wide snapshot. Returns ``None`` if every attempt fails.
    """
    def _one_attempt() -> Optional[pd.DataFrame]:
        use_alarm = _YF_BATCH_TIMEOUT > 0 and hasattr(signal, "SIGALRM")
        if use_alarm:
            old = signal.signal(signal.SIGALRM, _alarm_handler)
            signal.setitimer(signal.ITIMER_REAL, _YF_BATCH_TIMEOUT)
        try:
            return yf.download(
                yf_symbols,
                period=period,
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
        finally:
            if use_alarm:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old)

    attempt = 0
    while True:
        try:
            return _one_attempt()
        except Exception as exc:  # noqa: BLE001 — yfinance raises many types
            attempt += 1
            if attempt >= _YF_BATCH_RETRIES:
                LOGGER.warning(
                    "yf.download batch (%d symbols) failed after %d attempts: %s",
                    len(yf_symbols),
                    attempt,
                    exc,
                )
                return None
            sleep_for = min(_YF_BATCH_BACKOFF_CAP, _YF_BATCH_BACKOFF_BASE * (2 ** (attempt - 1)))
            sleep_for = random.uniform(0, sleep_for)  # full jitter
            LOGGER.info(
                "yf.download batch attempt %d failed (%s); retrying in %.2fs",
                attempt,
                exc,
                sleep_for,
            )
            time.sleep(sleep_for)


def fetch_many(
    tickers: Iterable[str],
    period: str = "6y",
    batch_size: int = 50,
) -> dict[str, list[Close]]:
    """Batch fetch closes for many tickers using ``yf.download``.

    yfinance's batch downloader is ~10× faster than per-ticker for large
    universes because Yahoo serves multiple tickers in a single request.
    Returns a dict keyed by our canonical tickers (not the yfinance form).

    Each batch is bounded by a wall-clock timeout (``YF_BATCH_TIMEOUT``) and
    retried with full-jitter backoff (``YF_BATCH_RETRIES``) so a transient
    Yahoo 429/5xx or a hung batch cannot stall the daily snapshot or amplify
    into an infinite retry loop. ``batch_size`` stays at 50.
    """
    canonical = list(tickers)
    if not canonical:
        return {}

    out: dict[str, list[Close]] = {t: [] for t in canonical}
    for chunk_start in range(0, len(canonical), batch_size):
        chunk = canonical[chunk_start : chunk_start + batch_size]
        yf_to_canonical: dict[str, str] = {}
        for c in chunk:
            yf_to_canonical.setdefault(ticker_to_yfinance_symbol(c), c)
        yf_symbols = list(yf_to_canonical.keys())
        if not yf_symbols:
            continue
        df = _download_batch(yf_symbols, period)
        if df is None or df.empty:
            continue

        if isinstance(df.columns, pd.MultiIndex):
            level0 = set(df.columns.get_level_values(0))
            for yf_sym in yf_symbols:
                if yf_sym not in level0:
                    continue
                sub = df[yf_sym]
                out[yf_to_canonical[yf_sym]] = _dataframe_to_closes(sub)
        else:
            # Single-ticker chunk
            yf_sym = yf_symbols[0]
            out[yf_to_canonical[yf_sym]] = _dataframe_to_closes(df)
    return out
