"""Daily equities snapshot orchestrator.

    uv run python -m high_signal_ingest.equities_daily [--limit N] [--batch B]

Builds the universe → fetches closes via yfinance → computes Tier 1 snapshot →
writes a JSONL artifact under ``data/equities-snapshot.jsonl``. The snapshot
is the only persisted artifact; daily closes are held in memory and discarded
after compute (the snapshot row carries all derived fields we need).

This module is the only stock-price ingress. Other workflows should consume
``data/equities-snapshot.jsonl`` or the future D1 ``closes`` /
``ticker_snapshot`` tables, not add their own Yahoo/Stooq/etc. fetchers.

Tier 2 (FX, dividend yield, Wikipedia pageviews) and Tier 3 (SEC XBRL,
Form 4, 13F, FINRA short interest, mentions joins) fields are left as
``None`` until those ingestors land.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import sys
from pathlib import Path
from typing import Optional

from .sources.equities.snapshot import Tier1Snapshot, compute_tier1
from .sources.equities.universe import TickerSpec, build_universe
from .sources.equities.yf import fetch_closes as yf_fetch, fetch_many as yf_fetch_many


LOGGER = logging.getLogger(__name__)


def _find_data_dir() -> Path:
    """Locate ``<high-signal repo>/data`` by walking up from this file."""
    here = Path(__file__).resolve()
    for ancestor in here.parents:
        candidate = ancestor / "data"
        if candidate.is_dir():
            return candidate
    return Path("/tmp")


def _snapshot_to_dict(t: TickerSpec, s: Tier1Snapshot) -> dict:
    """Flatten ticker metadata + Tier 1 snapshot into one JSONL row."""
    row = dataclasses.asdict(t)
    snap = dataclasses.asdict(s)
    snap.pop("ticker", None)  # already in `t`
    row.update(snap)
    return row


def run_daily(
    universe_limit: Optional[int] = None,
    period: str = "6y",
    out_path: Optional[Path] = None,
    batch_size: int = 50,
) -> Path:
    """Build universe, fetch closes, compute snapshots, write JSONL artifact.

    Returns the output path.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    universe = build_universe()
    if universe_limit is not None:
        universe = universe[:universe_limit]
    LOGGER.info("universe: %d tickers", len(universe))

    out_path = out_path or (_find_data_dir() / "equities-snapshot.jsonl")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # SPY anchors beta + relative strength.
    spy_closes = yf_fetch("SPY.US", period=period)
    if not spy_closes:
        LOGGER.warning("could not fetch SPY closes — beta/rel-strength will be None")

    # Batch-fetch closes for the rest of the universe (yf.download with threads).
    # Crypto handled by yfinance too (BTC-USD form already canonical).
    tickers_to_fetch = [s.ticker for s in universe]
    LOGGER.info("fetching closes for %d tickers (batch=%d)…", len(tickers_to_fetch), batch_size)
    closes_by_ticker = yf_fetch_many(tickers_to_fetch, period=period, batch_size=batch_size)

    n_written = 0
    n_with_data = 0
    with out_path.open("w") as f:
        for spec in universe:
            closes = closes_by_ticker.get(spec.ticker, [])
            if closes:
                snap = compute_tier1(spec.ticker, closes, spy_closes=spy_closes or None)
                n_with_data += 1
            else:
                snap = Tier1Snapshot(ticker=spec.ticker)
            f.write(json.dumps(_snapshot_to_dict(spec, snap)) + "\n")
            n_written += 1

    LOGGER.info(
        "wrote %d rows (%d with price data) to %s",
        n_written,
        n_with_data,
        out_path,
    )
    return out_path


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=None,
                   help="only process the first N tickers (for smoke runs)")
    p.add_argument("--period", default="6y",
                   help="yfinance period string for close history (default 6y, covers ret_5y)")
    p.add_argument("--out", type=Path, default=None,
                   help="output JSONL path (default: <repo>/data/equities-snapshot.jsonl)")
    p.add_argument("--batch", type=int, default=50,
                   help="batch size for yf.download (default 50)")
    args = p.parse_args(argv)
    run_daily(
        universe_limit=args.limit,
        period=args.period,
        out_path=args.out,
        batch_size=args.batch,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
