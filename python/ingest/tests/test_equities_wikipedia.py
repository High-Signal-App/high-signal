"""Wikipedia constituent fetcher — parser + Bloomberg ticker tests (no network)."""

from __future__ import annotations

import pandas as pd
import pytest

from high_signal_ingest.sources.equities.wikipedia_constituents import (
    WikipediaIndexSpec,
    parse_bloomberg_ticker,
    parse_wikipedia_table,
)


# ─── parse_bloomberg_ticker ───────────────────────────────────────────────


def test_bbg_us_strips_suffix() -> None:
    sym, ex, country, currency = parse_bloomberg_ticker("AAPL:US")
    assert sym == "AAPL"
    assert ex == "US"
    assert country == "US"
    assert currency == "USD"


def test_bbg_london() -> None:
    sym, ex, _, _ = parse_bloomberg_ticker("VOD:LN")
    assert sym == "VOD"
    assert ex == "L"


def test_bbg_germany_xetra() -> None:
    sym, ex, country, _ = parse_bloomberg_ticker("SAP:GR")
    assert sym == "SAP"
    assert ex == "DE"
    assert country == "DE"


def test_bbg_switzerland() -> None:
    sym, ex, _, currency = parse_bloomberg_ticker("NESN:SW")
    assert sym == "NESN"
    assert ex == "SW"
    assert currency == "CHF"


def test_bbg_unknown_country_returns_none_exchange() -> None:
    sym, ex, _, _ = parse_bloomberg_ticker("XXXX:ZZ")
    assert sym == "XXXX"
    assert ex is None


def test_bbg_missing_colon_passthrough() -> None:
    sym, ex, _, _ = parse_bloomberg_ticker("AAPL")
    assert sym == "AAPL"
    assert ex is None


def test_bbg_empty() -> None:
    sym, ex, _, _ = parse_bloomberg_ticker("")
    assert sym == ""
    assert ex is None


# ─── parse_wikipedia_table ────────────────────────────────────────────────


def test_parse_wikipedia_table_with_default_exchange() -> None:
    # TSX 60-style: simple symbol column + default exchange + currency
    df = pd.DataFrame(
        {
            "Symbol": ["RY", "TD", "SHOP"],
            "Company": ["Royal Bank of Canada", "TD Bank", "Shopify Inc."],
            "Sector": ["Financials", "Financials", "Technology"],
        }
    )
    spec = WikipediaIndexSpec(
        id="tsx_60",
        name="TSX 60",
        url="https://example",
        table_index=0,
        ticker_col="Symbol",
        name_col="Company",
        sector_col="Sector",
        default_exchange="TO",
        default_country="CA",
        currency="CAD",
    )
    specs = parse_wikipedia_table(df, spec)
    assert len(specs) == 3
    ry = specs[0]
    assert ry.ticker == "RY.TO"
    assert ry.symbol == "RY"
    assert ry.exchange == "TO"
    assert ry.name == "Royal Bank of Canada"
    assert ry.sector == "Financials"
    assert ry.country == "CA"
    assert ry.currency == "CAD"
    assert ry.asset_class == "equity"
    assert ry.source.startswith("wikipedia:")


def test_parse_wikipedia_table_with_country_name_lookup() -> None:
    # Real STOXX 600 layout: bare tickers + Country column
    df = pd.DataFrame(
        {
            "Ticker": ["ZURN", "VOD", "SAP", "INGA"],
            "Company": ["Zurich Insurance", "Vodafone", "SAP SE", "ING Groep"],
            "ICB Sector": ["Insurance", "Telecom", "Software", "Banks"],
            "Country": ["Switzerland", "United Kingdom", "Germany", "Netherlands"],
        }
    )
    spec = WikipediaIndexSpec(
        id="stoxx_600",
        name="STOXX 600",
        url="https://example",
        table_index=0,
        ticker_col="Ticker",
        name_col="Company",
        sector_col="ICB Sector",
        country_col="Country",
    )
    specs = parse_wikipedia_table(df, spec)
    assert len(specs) == 4
    by = {s.symbol: s for s in specs}
    assert by["ZURN"].ticker == "ZURN.SW"
    assert by["ZURN"].currency == "CHF"
    assert by["VOD"].ticker == "VOD.L"
    assert by["VOD"].currency == "GBP"
    assert by["SAP"].ticker == "SAP.DE"
    assert by["INGA"].ticker == "INGA.AS"
    assert by["INGA"].currency == "EUR"


def test_parse_wikipedia_table_skips_unknown_country() -> None:
    df = pd.DataFrame(
        {
            "Ticker": ["AAA", "BBB"],
            "Company": ["Known", "Unknown"],
            "Country": ["Germany", "Atlantis"],  # Atlantis not in our map
        }
    )
    spec = WikipediaIndexSpec(
        id="x", name="x", url="x", table_index=0,
        ticker_col="Ticker", name_col="Company", country_col="Country",
    )
    specs = parse_wikipedia_table(df, spec)
    assert len(specs) == 1
    assert specs[0].symbol == "AAA"


def test_parse_wikipedia_table_with_bloomberg_country_col() -> None:
    # STOXX 600-style: Bloomberg-format ticker + country column
    df = pd.DataFrame(
        {
            "Ticker": ["AAPL:US", "VOD:LN", "SAP:GR"],
            "Company": ["Apple", "Vodafone", "SAP"],
            "ICB Sector": ["Tech", "Telecom", "Software"],
            "Country": ["US", "UK", "Germany"],
        }
    )
    spec = WikipediaIndexSpec(
        id="stoxx_600",
        name="STOXX 600",
        url="https://example",
        table_index=0,
        ticker_col="Ticker",
        name_col="Company",
        sector_col="ICB Sector",
        country_col="Country",
    )
    specs = parse_wikipedia_table(df, spec)
    assert len(specs) == 3
    aapl = specs[0]
    assert aapl.ticker == "AAPL.US"
    assert aapl.exchange == "US"
    vod = specs[1]
    assert vod.ticker == "VOD.L"
    assert vod.exchange == "L"
    sap = specs[2]
    assert sap.ticker == "SAP.DE"


def test_parse_wikipedia_table_skips_missing_tickers() -> None:
    df = pd.DataFrame(
        {
            "Symbol": ["AAPL", "", "—", None, "MSFT"],
            "Company": ["Apple", "Empty", "Dash", "None", "Microsoft"],
        }
    )
    spec = WikipediaIndexSpec(
        id="x",
        name="x",
        url="x",
        table_index=0,
        ticker_col="Symbol",
        name_col="Company",
        default_exchange="US",
    )
    specs = parse_wikipedia_table(df, spec)
    tickers = [s.symbol for s in specs]
    assert "AAPL" in tickers
    assert "MSFT" in tickers
    assert "" not in tickers
    assert "—" not in tickers


def test_parse_wikipedia_table_dot_in_symbol_normalized() -> None:
    # Wikipedia sometimes uses BRK.B form; yfinance expects BRK-B
    df = pd.DataFrame({"Symbol": ["BRK.B"], "Company": ["Berkshire B"]})
    spec = WikipediaIndexSpec(
        id="x",
        name="x",
        url="x",
        table_index=0,
        ticker_col="Symbol",
        name_col="Company",
        default_exchange="US",
    )
    specs = parse_wikipedia_table(df, spec)
    assert specs[0].symbol == "BRK-B"
    assert specs[0].ticker == "BRK-B.US"


def test_parse_wikipedia_table_drops_bloomberg_unknown_country() -> None:
    # If the Bloomberg suffix isn't in our map, skip the row (better than guessing)
    df = pd.DataFrame(
        {
            "Ticker": ["AAPL:US", "FOO:ZZ"],
            "Company": ["Apple", "Foo"],
            "Country": ["US", "Unknown"],
        }
    )
    spec = WikipediaIndexSpec(
        id="x",
        name="x",
        url="x",
        table_index=0,
        ticker_col="Ticker",
        name_col="Company",
        country_col="Country",
    )
    specs = parse_wikipedia_table(df, spec)
    assert len(specs) == 1
    assert specs[0].symbol == "AAPL"


def test_parse_wikipedia_table_empty_df() -> None:
    spec = WikipediaIndexSpec(
        id="x", name="x", url="x", table_index=0, ticker_col="Symbol", default_exchange="US",
    )
    assert parse_wikipedia_table(pd.DataFrame({"Symbol": []}), spec) == []
