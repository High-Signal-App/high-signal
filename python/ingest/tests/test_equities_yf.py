"""yfinance adapter — symbol mapping + DataFrame conversion (no network)."""

from __future__ import annotations

import math

import pandas as pd
import pytest

from high_signal_ingest.sources.equities.snapshot import Close
from high_signal_ingest.sources.equities.yf import (
    _dataframe_to_closes,
    ticker_to_yfinance_symbol,
)


# ─── ticker_to_yfinance_symbol ────────────────────────────────────────────


def test_ticker_to_yf_us_strips_us_suffix() -> None:
    assert ticker_to_yfinance_symbol("AAPL.US") == "AAPL"
    assert ticker_to_yfinance_symbol("TSLA.US") == "TSLA"


def test_ticker_to_yf_japan_uses_T_suffix() -> None:
    assert ticker_to_yfinance_symbol("7203.JP") == "7203.T"


def test_ticker_to_yf_hk_keeps_hk_suffix() -> None:
    assert ticker_to_yfinance_symbol("700.HK") == "0700.HK" or ticker_to_yfinance_symbol("700.HK") == "700.HK"


def test_ticker_to_yf_lse() -> None:
    assert ticker_to_yfinance_symbol("VOD.L") == "VOD.L"


def test_ticker_to_yf_australia() -> None:
    assert ticker_to_yfinance_symbol("BHP.AX") == "BHP.AX"


def test_ticker_to_yf_germany() -> None:
    assert ticker_to_yfinance_symbol("SAP.DE") == "SAP.DE"


def test_ticker_to_yf_korea() -> None:
    assert ticker_to_yfinance_symbol("005930.KS") == "005930.KS"


def test_ticker_to_yf_canada() -> None:
    assert ticker_to_yfinance_symbol("SHOP.TO") == "SHOP.TO"


def test_ticker_to_yf_indices_passthrough() -> None:
    assert ticker_to_yfinance_symbol("^GSPC") == "^GSPC"
    assert ticker_to_yfinance_symbol("^IXIC") == "^IXIC"
    assert ticker_to_yfinance_symbol("^N225") == "^N225"
    assert ticker_to_yfinance_symbol("^HSI") == "^HSI"


def test_ticker_to_yf_crypto_passthrough() -> None:
    assert ticker_to_yfinance_symbol("BTC-USD") == "BTC-USD"
    assert ticker_to_yfinance_symbol("ETH-USD") == "ETH-USD"


def test_ticker_to_yf_unknown_exchange_falls_back_to_symbol() -> None:
    # Unknown exchange suffix → strip it (best-effort; yfinance may still resolve)
    assert ticker_to_yfinance_symbol("FOO.ZZ") in {"FOO.ZZ", "FOO"}


# ─── _dataframe_to_closes ─────────────────────────────────────────────────


def test_dataframe_to_closes_basic() -> None:
    df = pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [102.0, 103.0],
            "Low": [99.0, 100.0],
            "Close": [101.0, 102.5],
            "Volume": [1000.0, 1500.0],
        },
        index=pd.to_datetime(["2024-01-02", "2024-01-03"]),
    )
    closes = _dataframe_to_closes(df)
    assert len(closes) == 2
    assert closes[0].date == 20240102
    assert closes[0].close == pytest.approx(101.0)
    assert closes[0].volume == pytest.approx(1000.0)
    assert closes[1].date == 20240103


def test_dataframe_to_closes_empty_or_none() -> None:
    assert _dataframe_to_closes(None) == []
    assert _dataframe_to_closes(pd.DataFrame()) == []


def test_dataframe_to_closes_missing_close_column() -> None:
    df = pd.DataFrame(
        {"Open": [100.0]},
        index=pd.to_datetime(["2024-01-02"]),
    )
    assert _dataframe_to_closes(df) == []


def test_dataframe_to_closes_skips_nan_close() -> None:
    df = pd.DataFrame(
        {
            "Close": [100.0, math.nan, 102.0],
            "Volume": [1000, 0, 1500],
        },
        index=pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"]),
    )
    closes = _dataframe_to_closes(df)
    assert len(closes) == 2
    assert closes[0].date == 20240102
    assert closes[1].date == 20240104


def test_dataframe_to_closes_sorts_ascending() -> None:
    df = pd.DataFrame(
        {"Close": [102.0, 100.0, 101.0]},
        index=pd.to_datetime(["2024-01-04", "2024-01-02", "2024-01-03"]),
    )
    closes = _dataframe_to_closes(df)
    assert [c.date for c in closes] == [20240102, 20240103, 20240104]


def test_dataframe_to_closes_nan_volume_becomes_none() -> None:
    df = pd.DataFrame(
        {
            "Close": [100.0],
            "Volume": [math.nan],
        },
        index=pd.to_datetime(["2024-01-02"]),
    )
    closes = _dataframe_to_closes(df)
    assert len(closes) == 1
    assert closes[0].volume is None
