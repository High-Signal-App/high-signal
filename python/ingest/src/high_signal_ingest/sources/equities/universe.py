"""Equities universe builder.

Composes the canonical universe from:
- S&P 500 constituents via the `datasets/s-and-p-500-companies` GitHub-hosted
  CSV → ~500 US tickers (broader iShares Russell 3000 CSV is now bot-blocked)
- Curated seed CSVs (indices, ETFs) → ~165 tickers
- CoinGecko top-N → ~100 crypto tickers

Wikipedia international constituent lists (STOXX 600 / Nikkei 225 / HSI / etc.)
remain planned for Phase 1.5b.

Parsers are split out so they can be unit-tested without network.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

import httpx


LOGGER = logging.getLogger(__name__)

SEED_DIR = Path(__file__).resolve().parents[2] / "seed"

SP500_CONSTITUENTS_URL = (
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/"
    "main/data/constituents.csv"
)
COINGECKO_TOP_N_URL = (
    "https://api.coingecko.com/api/v3/coins/markets"
    "?vs_currency=usd&order=market_cap_desc&per_page={n}&page=1"
)
USER_AGENT = "high-signal/0.1 universe-build"
HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


@dataclass
class TickerSpec:
    """Canonical ticker entry written to the ``tickers`` table."""

    ticker: str
    symbol: str
    exchange: str
    asset_class: str  # equity | etf | index | crypto
    name: Optional[str] = None
    currency: Optional[str] = None
    country: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    wikidata_id: Optional[str] = None
    cik: Optional[str] = None
    isin: Optional[str] = None
    source: Optional[str] = None  # which fetcher produced this row


# ─── seed CSV loader ──────────────────────────────────────────────────────


def load_seed_csv(path: Path) -> list[TickerSpec]:
    """Load a curated seed CSV (the indices + ETFs files in seed/)."""
    if not path.exists():
        return []
    specs: list[TickerSpec] = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            ticker = (row.get("ticker") or "").strip()
            if not ticker:
                continue
            specs.append(
                TickerSpec(
                    ticker=ticker,
                    symbol=(row.get("symbol") or ticker).strip(),
                    exchange=(row.get("exchange") or "").strip(),
                    name=(row.get("name") or "").strip() or None,
                    asset_class=(row.get("asset_class") or "equity").strip(),
                    currency=(row.get("currency") or "").strip() or None,
                    country=(row.get("country") or "").strip() or None,
                    source=f"seed:{path.name}",
                )
            )
    return specs


def load_ai_infra_entities(path: Optional[Path] = None) -> list[TickerSpec]:
    """Pull tickers from ai_infra_entities.csv into the universe.

    This guarantees every entity the daily-brief / signals pipeline already
    tracks (NVDA, ADRs like TSM/ASML/BABA, etc.) gets a snapshot row,
    even if the entity isn't in the S&P 500.
    """
    path = path or (SEED_DIR / "ai_infra_entities.csv")
    if not path.exists():
        return []
    specs: list[TickerSpec] = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("type") or "").strip().lower() != "public":
                continue
            symbol = (row.get("ticker") or "").strip()
            if not symbol:
                continue
            # Country in this CSV reflects the company HQ; for the equities
            # universe the exchange matters more. ADRs trade on US exchanges,
            # so default to .US unless the ticker already carries a suffix.
            ticker = symbol if "." in symbol or symbol.startswith("^") else f"{symbol}.US"
            exchange = "US" if ticker.endswith(".US") else ticker.split(".", 1)[1] if "." in ticker else ""
            specs.append(
                TickerSpec(
                    ticker=ticker,
                    symbol=symbol,
                    exchange=exchange,
                    name=(row.get("name") or "").strip() or None,
                    asset_class="equity",
                    currency="USD" if exchange == "US" else None,
                    country=(row.get("country") or "").strip() or None,
                    sector=(row.get("sector") or "").strip() or None,
                    industry=(row.get("subsector") or "").strip() or None,
                    source="ai_infra_entities",
                )
            )
    return specs


# ─── S&P 500 constituents parser ──────────────────────────────────────────


def parse_sp500_csv(csv_text: str) -> list[TickerSpec]:
    """Parse the ``datasets/s-and-p-500-companies`` constituents.csv.

    Columns: ``Symbol, Security, GICS Sector, GICS Sub-Industry,
    Headquarters Location, Date added, CIK, Founded``.

    Yahoo/yfinance uses ``-`` as the class separator (BRK-B, not BRK.B), so
    we substitute on the way in to keep the canonical ticker compatible.
    """
    if not csv_text:
        return []
    reader = csv.reader(io.StringIO(csv_text))
    try:
        header = next(reader)
    except StopIteration:
        return []
    idx = {h.strip().lower(): i for i, h in enumerate(header)}
    sym_idx = idx.get("symbol")
    name_idx = idx.get("security")
    sector_idx = idx.get("gics sector")
    industry_idx = idx.get("gics sub-industry")
    cik_idx = idx.get("cik")
    if sym_idx is None:
        return []
    specs: list[TickerSpec] = []
    for row in reader:
        if len(row) <= sym_idx:
            continue
        symbol = row[sym_idx].strip().replace(".", "-")
        if not symbol:
            continue
        name = row[name_idx].strip() if name_idx is not None and len(row) > name_idx else None
        sector = row[sector_idx].strip() if sector_idx is not None and len(row) > sector_idx else None
        industry = row[industry_idx].strip() if industry_idx is not None and len(row) > industry_idx else None
        cik = row[cik_idx].strip() if cik_idx is not None and len(row) > cik_idx else None
        specs.append(
            TickerSpec(
                ticker=f"{symbol}.US",
                symbol=symbol,
                exchange="US",
                name=name or None,
                asset_class="equity",
                currency="USD",
                country="US",
                sector=sector or None,
                industry=industry or None,
                cik=cik or None,
                source="sp500_constituents",
            )
        )
    return specs


# ─── CoinGecko crypto parser ──────────────────────────────────────────────


def parse_coingecko_top_n(data: Any) -> list[TickerSpec]:
    """CoinGecko ``/coins/markets`` JSON → crypto TickerSpecs."""
    if not data or not isinstance(data, list):
        return []
    specs: list[TickerSpec] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        symbol_raw = entry.get("symbol")
        name = entry.get("name")
        if not symbol_raw or not name:
            continue
        symbol = str(symbol_raw).upper()
        specs.append(
            TickerSpec(
                ticker=f"{symbol}-USD",
                symbol=symbol,
                exchange="CRYPTO",
                name=str(name),
                asset_class="crypto",
                currency="USD",
                source="coingecko",
            )
        )
    return specs


# ─── dedupe ───────────────────────────────────────────────────────────────


def dedupe(specs: Iterable[TickerSpec]) -> list[TickerSpec]:
    """Drop later occurrences of the same ticker. Order-preserving."""
    seen: set[str] = set()
    out: list[TickerSpec] = []
    for s in specs:
        if s.ticker in seen:
            continue
        seen.add(s.ticker)
        out.append(s)
    return out


# ─── fetchers (network) ───────────────────────────────────────────────────


def fetch_sp500_constituents(client: Optional[httpx.Client] = None) -> list[TickerSpec]:
    """Pull the S&P 500 constituent list from the GitHub-hosted CSV."""
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT,
            follow_redirects=True,
        )
    try:
        r = client.get(SP500_CONSTITUENTS_URL)
        if r.status_code != 200:
            LOGGER.warning("sp500 constituents status=%s", r.status_code)
            return []
        return parse_sp500_csv(r.text)
    except httpx.HTTPError as exc:
        LOGGER.warning("sp500 constituents error: %s", exc)
        return []
    finally:
        if owns_client:
            client.close()


def fetch_coingecko_top_n(n: int = 100, client: Optional[httpx.Client] = None) -> list[TickerSpec]:
    """Pull top-N crypto by market cap from CoinGecko."""
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT,
            follow_redirects=True,
        )
    try:
        r = client.get(COINGECKO_TOP_N_URL.format(n=n))
        if r.status_code != 200:
            LOGGER.warning("coingecko status=%s", r.status_code)
            return []
        return parse_coingecko_top_n(r.json())
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        LOGGER.warning("coingecko error: %s", exc)
        return []
    finally:
        if owns_client:
            client.close()


# ─── public orchestrator ──────────────────────────────────────────────────


def build_universe(client: Optional[httpx.Client] = None) -> list[TickerSpec]:
    """Compose the canonical universe from all configured sources.

    Order matters for dedupe: the S&P 500 list goes first (carries GICS
    sector + CIK), so it wins over the seed CSVs (which only carry ticker
    + name + asset class) for any overlap.
    """
    owns_client = client is None
    if client is None:
        client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT,
            follow_redirects=True,
        )
    try:
        # Imported here to avoid a module-level import cycle (wikipedia_constituents
        # imports TickerSpec from this module).
        from .wikipedia_constituents import fetch_all_wikipedia_constituents

        specs: list[TickerSpec] = []
        specs.extend(fetch_sp500_constituents(client=client))
        specs.extend(load_ai_infra_entities())
        specs.extend(fetch_all_wikipedia_constituents(client=client))
        specs.extend(load_seed_csv(SEED_DIR / "equities_indices.csv"))
        specs.extend(load_seed_csv(SEED_DIR / "equities_etfs.csv"))
        specs.extend(fetch_coingecko_top_n(100, client=client))
        return dedupe(specs)
    finally:
        if owns_client:
            client.close()
