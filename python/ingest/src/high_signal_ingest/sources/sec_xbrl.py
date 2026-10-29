"""Compatibility entry point; collection and normalization belong to stock data."""

from ..stock_data_collectors.sec_xbrl import (
    FACTS,
    FACTS_URL,
    TICKERS_URL,
    event_from_companyfacts,
    fetch_all,
    ticker_cik_map,
)

__all__ = [
    "FACTS",
    "FACTS_URL",
    "TICKERS_URL",
    "event_from_companyfacts",
    "fetch_all",
    "ticker_cik_map",
]
