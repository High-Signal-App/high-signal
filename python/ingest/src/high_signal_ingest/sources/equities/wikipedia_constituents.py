"""Wikipedia constituent-list fetchers for international indices.

Fills the gap between the S&P 500 (already wired via the GitHub-hosted CSV)
and the canonical-universe target by scraping Wikipedia's constituent tables
for non-US indices. Uses ``pandas.read_html`` (pandas already comes in via
yfinance).

Each index has a small ``WikipediaIndexSpec``: URL + which `<table>` index
holds the constituents + column names + default exchange/country/currency.
STOXX Europe 600 is the only one with Bloomberg-style country-suffixed
tickers (``AAPL:US``, ``VOD:LN`` …), so it carries a ``country_col`` and
goes through ``parse_bloomberg_ticker`` instead of the default ``.suffix``
appender.

Skipped because Wikipedia doesn't actually list the constituents:
Russell 3000, Nikkei 225, HSI Composite, NIFTY 100.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from typing import Optional

import httpx
import pandas as pd

from .universe import TickerSpec


LOGGER = logging.getLogger(__name__)

# Wikipedia's User-Agent policy (meta.wikimedia.org/wiki/User-Agent_policy)
# rejects generic UAs from cloud IPs with 403. Must include tool + contact.
USER_AGENT = (
    "high-signal-equities/0.1 "
    "(+https://github.com/sarthakagrawal927/high-signal; "
    "contact: sarthak@vaultwealth.com) "
    "wikipedia-constituents"
)
HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


@dataclass(frozen=True)
class WikipediaIndexSpec:
    id: str
    name: str
    url: str
    table_index: int
    ticker_col: str
    name_col: Optional[str] = None
    sector_col: Optional[str] = None
    country_col: Optional[str] = None  # only set for Bloomberg-suffixed tickers (STOXX 600)
    default_exchange: Optional[str] = None
    default_country: Optional[str] = None
    currency: Optional[str] = None


# Bloomberg country-suffix mapping (kept as a utility for any future Wiki
# page that lists tickers like ``AAPL:US``). The current STOXX 600 page
# does NOT use this format — tickers there are bare symbols, with a
# separate ``Country`` column.
_BBG_COUNTRY_TO_EXCHANGE: dict[str, tuple[str, str, str]] = {
    "US": ("US", "US", "USD"),
    "LN": ("L",  "UK", "GBP"),
    "GR": ("DE", "DE", "EUR"),
    "FP": ("PA", "FR", "EUR"),
    "NA": ("AS", "NL", "EUR"),
    "BB": ("BR", "BE", "EUR"),
    "IM": ("MI", "IT", "EUR"),
    "SM": ("MC", "ES", "EUR"),
    "SW": ("SW", "CH", "CHF"),
    "SS": ("ST", "SE", "SEK"),
    "DC": ("CO", "DK", "DKK"),
    "NO": ("OL", "NO", "NOK"),
    "FH": ("HE", "FI", "EUR"),
    "AV": ("VI", "AT", "EUR"),
    "PW": ("WA", "PL", "PLN"),
    "PL": ("LS", "PT", "EUR"),
    "ID": ("ID", "IE", "EUR"),
    "IR": ("ID", "IE", "EUR"),
    "GA": ("AT", "GR", "EUR"),
    "CK": ("PR", "CZ", "CZK"),
    "HK": ("HK", "HK", "HKD"),
}


# Wikipedia "Country" column name → (canonical exchange code, currency).
# Used by STOXX 600 (bare-ticker + Country column model).
_COUNTRY_NAME_TO_EXCHANGE: dict[str, tuple[str, str]] = {
    "Switzerland": ("SW", "CHF"),
    "United Kingdom": ("L", "GBP"),
    "UK": ("L", "GBP"),
    "Germany": ("DE", "EUR"),
    "France": ("PA", "EUR"),
    "Netherlands": ("AS", "EUR"),
    "Italy": ("MI", "EUR"),
    "Spain": ("MC", "EUR"),
    "Sweden": ("ST", "SEK"),
    "Belgium": ("BR", "EUR"),
    "Denmark": ("CO", "DKK"),
    "Finland": ("HE", "EUR"),
    "Norway": ("OL", "NOK"),
    "Austria": ("VI", "EUR"),
    "Portugal": ("LS", "EUR"),
    "Ireland": ("ID", "EUR"),
    "Poland": ("WA", "PLN"),
    "Czech Republic": ("PR", "CZK"),
    "Luxembourg": ("LU", "EUR"),
    "Greece": ("AT", "EUR"),
    "Hungary": ("BD", "HUF"),
    "Russia": ("ME", "RUB"),
    "Romania": ("RO", "RON"),
}


SPECS: list[WikipediaIndexSpec] = [
    WikipediaIndexSpec(
        id="stoxx_600",
        name="STOXX Europe 600",
        url="https://en.wikipedia.org/wiki/STOXX_Europe_600",
        table_index=2,
        ticker_col="Ticker",
        name_col="Company",
        sector_col="ICB Sector",
        country_col="Country",
    ),
    WikipediaIndexSpec(
        id="tsx_60",
        name="S&P/TSX 60",
        url="https://en.wikipedia.org/wiki/S%26P/TSX_60",
        table_index=1,
        ticker_col="Symbol",
        name_col="Company",
        sector_col="Sector",
        default_exchange="TO",
        default_country="CA",
        currency="CAD",
    ),
    WikipediaIndexSpec(
        id="tsx_composite",
        name="S&P/TSX Composite",
        url="https://en.wikipedia.org/wiki/S%26P/TSX_Composite_Index",
        table_index=3,
        ticker_col="Ticker",
        name_col="Company",
        sector_col="Sector [10]",
        default_exchange="TO",
        default_country="CA",
        currency="CAD",
    ),
    WikipediaIndexSpec(
        id="asx_200",
        name="S&P/ASX 200",
        url="https://en.wikipedia.org/wiki/S%26P/ASX_200",
        table_index=2,
        ticker_col="Code",
        name_col="Company",
        sector_col="Sector",
        default_exchange="AX",
        default_country="AU",
        currency="AUD",
    ),
    WikipediaIndexSpec(
        id="kospi_200",
        name="KOSPI 200",
        url="https://en.wikipedia.org/wiki/KOSPI_200",
        table_index=2,
        ticker_col="Symbol",
        name_col="Company",
        sector_col="GICS Sector",
        default_exchange="KS",
        default_country="KR",
        currency="KRW",
    ),
    WikipediaIndexSpec(
        id="nifty_50",
        name="NIFTY 50",
        url="https://en.wikipedia.org/wiki/NIFTY_50",
        table_index=1,
        ticker_col="Symbol",
        name_col="Company name",
        sector_col="Sector[15]",
        default_exchange="NS",
        default_country="IN",
        currency="INR",
    ),
    WikipediaIndexSpec(
        id="hang_seng_index",
        name="Hang Seng Index",
        url="https://en.wikipedia.org/wiki/Hang_Seng_Index",
        table_index=6,
        ticker_col="Ticker",
        name_col="Name",
        sector_col="Sub-index",
        default_exchange="HK",
        default_country="HK",
        currency="HKD",
    ),
]


def parse_bloomberg_ticker(
    bbg_ticker: str,
) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
    """``AAPL:US`` → (``AAPL``, ``US``, ``US``, ``USD``).

    Returns ``(symbol, exchange, country, currency)``. ``exchange`` is ``None``
    when the Bloomberg suffix isn't in our mapping (caller should drop the row).
    """
    if not bbg_ticker or ":" not in bbg_ticker:
        return bbg_ticker, None, None, None
    sym, suffix = bbg_ticker.rsplit(":", 1)
    info = _BBG_COUNTRY_TO_EXCHANGE.get(suffix.strip().upper())
    if info:
        ex, country, currency = info
        return sym.strip(), ex, country, currency
    return sym.strip(), None, None, None


def _clean(value) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() == "nan" or s in {"—", "-", "–"}:
        return None
    return s


def parse_wikipedia_table(
    df: pd.DataFrame,
    spec: WikipediaIndexSpec,
) -> list[TickerSpec]:
    """Convert a Wikipedia constituent DataFrame into a list of ``TickerSpec``."""
    if df is None or df.empty or spec.ticker_col not in df.columns:
        return []
    out: list[TickerSpec] = []
    for _, row in df.iterrows():
        raw_ticker = _clean(row.get(spec.ticker_col))
        if not raw_ticker:
            continue

        if spec.country_col:
            # Two formats handled here:
            #   - Bloomberg ``AAPL:US`` (parse from ticker)
            #   - Bare symbol + Country column lookup (STOXX 600 actual layout)
            if ":" in raw_ticker:
                sym, exchange, country, currency = parse_bloomberg_ticker(raw_ticker)
                if not exchange:
                    continue
            else:
                country_name = _clean(row.get(spec.country_col))
                if not country_name:
                    continue
                lookup = _COUNTRY_NAME_TO_EXCHANGE.get(country_name)
                if lookup is None:
                    continue  # unknown country → skip rather than guess
                exchange, currency = lookup
                country = country_name
                sym = raw_ticker
        else:
            sym = raw_ticker.replace(".", "-")  # BRK.B → BRK-B for yfinance compat
            exchange = spec.default_exchange or "US"
            country = spec.default_country
            currency = spec.currency

        if not sym:
            continue

        name = _clean(row.get(spec.name_col)) if spec.name_col else None
        sector = _clean(row.get(spec.sector_col)) if spec.sector_col else None

        out.append(
            TickerSpec(
                ticker=f"{sym}.{exchange}",
                symbol=sym,
                exchange=exchange,
                name=name,
                asset_class="equity",
                currency=currency,
                country=country,
                sector=sector,
                source=f"wikipedia:{spec.id}",
            )
        )
    return out


def fetch_wikipedia_constituents(
    spec: WikipediaIndexSpec,
    client: Optional[httpx.Client] = None,
) -> list[TickerSpec]:
    """Fetch one Wikipedia page and parse its configured constituent table."""
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT,
            follow_redirects=True,
        )
    try:
        r = client.get(spec.url)
        if r.status_code != 200:
            LOGGER.warning("wikipedia %s status=%s", spec.id, r.status_code)
            return []
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            tables = pd.read_html(r.text)
        if spec.table_index >= len(tables):
            LOGGER.warning(
                "wikipedia %s: table[%d] out of range (%d tables)",
                spec.id,
                spec.table_index,
                len(tables),
            )
            return []
        return parse_wikipedia_table(tables[spec.table_index], spec)
    except Exception as exc:  # noqa: BLE001 — pandas/httpx raise a wide variety
        LOGGER.warning("wikipedia %s error: %s", spec.id, exc)
        return []
    finally:
        if owns_client:
            client.close()


def fetch_all_wikipedia_constituents(
    client: Optional[httpx.Client] = None,
) -> list[TickerSpec]:
    """Pull constituents from every ``SPECS`` entry. Order-preserving."""
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT,
            follow_redirects=True,
        )
    try:
        out: list[TickerSpec] = []
        for spec in SPECS:
            out.extend(fetch_wikipedia_constituents(spec, client=client))
        return out
    finally:
        if owns_client:
            client.close()
