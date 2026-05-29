"""Universe builder — normalizer + seed-CSV loader tests (no network)."""

from __future__ import annotations

from pathlib import Path

import pytest

from high_signal_ingest.sources.equities.universe import (
    SEED_DIR,
    TickerSpec,
    dedupe,
    load_seed_csv,
    parse_coingecko_top_n,
    parse_sp500_csv,
)


# ─── parse_sp500_csv ──────────────────────────────────────────────────────


def _sp500_fixture() -> str:
    return (
        "Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded\n"
        "AAPL,Apple Inc.,Information Technology,Technology Hardware Storage & Peripherals,"
        '"Cupertino, California",1982-11-30,320193,1977\n'
        "MSFT,Microsoft,Information Technology,Systems Software,"
        '"Redmond, Washington",1994-06-01,789019,1975\n'
        "BRK.B,Berkshire Hathaway,Financials,Multi-Sector Holdings,"
        '"Omaha, Nebraska",2010-02-16,1067983,1839\n'
    )


def test_parse_sp500_csv_basic() -> None:
    specs = parse_sp500_csv(_sp500_fixture())
    assert len(specs) == 3
    aapl = specs[0]
    assert aapl.ticker == "AAPL.US"
    assert aapl.symbol == "AAPL"
    assert aapl.exchange == "US"
    assert aapl.name == "Apple Inc."
    assert aapl.sector == "Information Technology"
    assert aapl.industry == "Technology Hardware Storage & Peripherals"
    assert aapl.asset_class == "equity"
    assert aapl.currency == "USD"
    assert aapl.country == "US"
    assert aapl.cik == "320193"


def test_parse_sp500_csv_class_separator_normalized() -> None:
    # Yahoo/yfinance uses BRK-B (hyphen) not BRK.B (dot).
    specs = parse_sp500_csv(_sp500_fixture())
    brk = next(s for s in specs if "Berkshire" in (s.name or ""))
    assert brk.ticker == "BRK-B.US"
    assert brk.symbol == "BRK-B"


def test_parse_sp500_csv_empty() -> None:
    assert parse_sp500_csv("") == []
    assert parse_sp500_csv("only-header,but,nothing\n") == []


# ─── parse_coingecko_top_n ────────────────────────────────────────────────


def test_parse_coingecko_basic() -> None:
    data = [
        {"id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "market_cap": 1.2e12},
        {"id": "ethereum", "symbol": "eth", "name": "Ethereum", "market_cap": 5.0e11},
    ]
    specs = parse_coingecko_top_n(data)
    assert len(specs) == 2
    btc = specs[0]
    assert btc.ticker == "BTC-USD"
    assert btc.symbol == "BTC"
    assert btc.asset_class == "crypto"
    assert btc.currency == "USD"
    assert btc.name == "Bitcoin"


def test_parse_coingecko_skips_malformed_entries() -> None:
    data = [
        {"id": "ok", "symbol": "OK", "name": "Okay"},
        {"id": "missing-symbol"},  # no symbol
        {"symbol": "noname"},      # no name
        "not a dict",
    ]
    specs = parse_coingecko_top_n(data)
    assert len(specs) == 1
    assert specs[0].ticker == "OK-USD"


def test_parse_coingecko_empty() -> None:
    assert parse_coingecko_top_n([]) == []
    assert parse_coingecko_top_n(None) == []  # type: ignore[arg-type]


# ─── dedupe ───────────────────────────────────────────────────────────────


def test_dedupe_keeps_first_occurrence() -> None:
    specs = [
        TickerSpec(ticker="AAPL.US", symbol="AAPL", exchange="US", asset_class="equity"),
        TickerSpec(
            ticker="AAPL.US",
            symbol="AAPL",
            exchange="US",
            asset_class="equity",
            name="Apple Inc",
        ),
    ]
    out = dedupe(specs)
    assert len(out) == 1
    assert out[0].name is None


def test_dedupe_preserves_order() -> None:
    specs = [
        TickerSpec(ticker="A", symbol="A", exchange="US", asset_class="equity"),
        TickerSpec(ticker="B", symbol="B", exchange="US", asset_class="equity"),
        TickerSpec(ticker="A", symbol="A", exchange="US", asset_class="equity"),
        TickerSpec(ticker="C", symbol="C", exchange="US", asset_class="equity"),
    ]
    out = dedupe(specs)
    assert [s.ticker for s in out] == ["A", "B", "C"]


# ─── seed CSV loaders ─────────────────────────────────────────────────────


def test_load_seed_csv_indices() -> None:
    path = SEED_DIR / "equities_indices.csv"
    if not path.exists():
        pytest.skip("seed CSV not present")
    specs = load_seed_csv(path)
    assert len(specs) >= 25
    tickers = {s.ticker for s in specs}
    assert "^GSPC" in tickers
    assert all(s.asset_class == "index" for s in specs)


def test_load_seed_csv_etfs() -> None:
    path = SEED_DIR / "equities_etfs.csv"
    if not path.exists():
        pytest.skip("seed CSV not present")
    specs = load_seed_csv(path)
    assert len(specs) >= 100
    assert all(s.asset_class == "etf" for s in specs)


def test_seed_indices_csv_has_no_dupes() -> None:
    path = SEED_DIR / "equities_indices.csv"
    if not path.exists():
        pytest.skip("seed CSV not present")
    specs = load_seed_csv(path)
    tickers = [s.ticker for s in specs]
    assert len(tickers) == len(set(tickers)), "duplicate tickers in indices CSV"


def test_seed_etfs_csv_has_no_dupes() -> None:
    path = SEED_DIR / "equities_etfs.csv"
    if not path.exists():
        pytest.skip("seed CSV not present")
    specs = load_seed_csv(path)
    tickers = [s.ticker for s in specs]
    dupes = [t for t in tickers if tickers.count(t) > 1]
    assert len(tickers) == len(set(tickers)), f"duplicate tickers in ETFs CSV: {set(dupes)}"
