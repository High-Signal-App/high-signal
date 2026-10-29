"""Daily equities snapshot orchestrator.

    uv run python -m high_signal_ingest.equities_daily [--limit N] [--batch B]

Builds the universe → fetches closes via yfinance → computes Tier 1 snapshot →
writes a JSONL artifact under ``data/equities-snapshot.jsonl``. The snapshot
is a compatibility projection. Price observations, actions and revisions are
retained by the shared stock-data store only during the explicit bounded pilot.
Scheduled compatibility runs publish identity metadata while price rights and
history retention remain unqualified.

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .sources.equities.snapshot import Tier1Snapshot, compute_tier1
from .sources.equities.universe import TickerSpec, build_universe
from .sources.equities.yf import fetch_many as yf_fetch_many
from .stock_data.store import StockStore
from .stock_data_prices import (
    issuer_id,
    persist_prices,
    price_inputs,
    stock_store_path,
    versioned_prices,
)


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


def _snapshot_row(
    store: StockStore, spec: TickerSpec, closes: list, spy: list, now: str, retain: bool
) -> dict:
    snap = (
        compute_tier1(spec.ticker, closes, spy_closes=spy or None)
        if closes
        else Tier1Snapshot(ticker=spec.ticker)
    )
    row = _snapshot_to_dict(spec, snap)
    row["inputSnapshotIds"] = []
    try:
        row["entityId"] = issuer_id(store, spec)
        if retain:
            with store.transaction():
                persist_prices(store, spec, closes, ingested_at=now)
                if closes:
                    row["inputSnapshotIds"] = [
                        price_inputs(store, spec.ticker, closes, spy, as_of=now)
                    ]
    except ValueError as exc:
        LOGGER.warning("Listing withheld: %s: %s", spec.ticker, exc)
        row["entityId"] = f"unresolved:{spec.ticker}"
        row["identityStatus"] = "conflict"
        row["inputIssue"] = str(exc)
        for field in dataclasses.fields(Tier1Snapshot):
            if field.name != "ticker":
                row[field.name] = None
    return row


def _price_manifest_rows(rows: list[dict], retain: bool) -> list[dict]:
    if retain:
        return rows
    # The scheduled compatibility computation continues, but unretained numerical
    # inputs cannot masquerade as a versioned, publicly qualified dataset.
    return [
        {
            key: row[key]
            for key in (
                "ticker",
                "symbol",
                "name",
                "currency",
                "country",
                "entityId",
                "inputSnapshotIds",
                "identityStatus",
                "inputIssue",
            )
            if key in row
        }
        for row in rows
    ]


def run_daily(
    universe_limit: Optional[int] = None,
    period: str = "6y",
    out_path: Optional[Path] = None,
    batch_size: int = 50,
    retain_history: bool = False,
) -> Path:
    """Run the sole price ingress; retained history is a bounded, explicit pilot."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    universe = build_universe()
    if universe_limit is not None:
        if universe_limit < 1:
            raise ValueError("universe limit must be positive")
        universe = universe[:universe_limit]
    if retain_history and (len(universe) > 20 or period != "1mo"):
        raise ValueError("Retained-history pilot requires at most 20 tickers and --period 1mo")
    out_path = out_path or (_find_data_dir() / "equities-snapshot.jsonl")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tickers = list(dict.fromkeys(["SPY.US", *(spec.ticker for spec in universe)]))
    closes = yf_fetch_many(tickers, period=period, batch_size=batch_size)
    if not any(closes.get(spec.ticker) for spec in universe):
        raise RuntimeError(
            "Canonical equity refresh returned no company prices; previous snapshots are preserved"
        )
    spy = closes.get("SPY.US", [])
    now = datetime.now(timezone.utc).isoformat()
    with StockStore(stock_store_path(out_path.parent)) as store:
        if retain_history:
            with store.transaction():
                persist_prices(
                    store,
                    TickerSpec("SPY.US", "SPY", "US", "etf", currency="USD", country="US"),
                    spy,
                    ingested_at=now,
                )
        rows = [
            _snapshot_row(store, spec, closes.get(spec.ticker, []), spy, now, retain_history)
            for spec in universe
        ]
        manifest = versioned_prices(
            _price_manifest_rows(rows, retain_history),
            generated_at=now,
            history_available=retain_history,
            rights=store.rights("yahoo-finance") if retain_history else None,
        )
    manifest["universeComplete"] = universe_limit is None and not retain_history
    temporary = out_path.with_suffix(".tmp")
    temporary.write_text("".join(json.dumps(row) + "\n" for row in rows))
    temporary.replace(out_path)
    manifest_path = out_path.parent / "stock-data-prices.json"
    temporary = manifest_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, allow_nan=False) + "\n")
    temporary.replace(manifest_path)
    LOGGER.info("wrote %d rows; retained-history pilot=%s", len(rows), retain_history)
    return out_path


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--limit", type=int, default=None, help="only process the first N tickers (for smoke runs)"
    )
    p.add_argument(
        "--period",
        default="6y",
        help="yfinance period string for close history (default 6y, covers ret_5y)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output JSONL path (default: <repo>/data/equities-snapshot.jsonl)",
    )
    p.add_argument("--batch", type=int, default=50, help="batch size for yf.download (default 50)")
    p.add_argument(
        "--retain-history",
        action="store_true",
        help="bounded pilot only: <=20 tickers, --period 1mo",
    )
    args = p.parse_args(argv)
    run_daily(
        universe_limit=args.limit,
        period=args.period,
        out_path=args.out,
        batch_size=args.batch,
        retain_history=args.retain_history,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
