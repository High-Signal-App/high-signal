"""Forward-return scoring runner.

Pulls /admin/pending-scores from the worker API, computes forward returns via
yfinance for each signal whose window has elapsed, then POSTs the resulting
score_run rows back to /admin/scores.

Auth: bearer token from env ADMIN_TOKEN.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from .backtest import classify, forward_return


LOGGER = logging.getLogger(__name__)


def _api_base() -> str:
    return os.environ.get("API_BASE", "https://api.highsignal.app")


def _admin_token() -> str:
    token = os.environ.get("ADMIN_TOKEN")
    if not token:
        raise RuntimeError("ADMIN_TOKEN not set")
    return token


def _ticker_for_entity(entity_id: str) -> str | None:
    """Resolve entity_id → ticker via the seeded entities CSV."""
    from ..seed import load_entities

    for e in load_entities():
        if e.id == entity_id:
            return e.ticker
    return None


def fetch_pending(client: httpx.Client) -> list[dict[str, Any]]:
    r = client.get(
        f"{_api_base()}/admin/pending-scores",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )
    r.raise_for_status()
    return list(r.json().get("pending", []))


def score_one(row: dict[str, Any]) -> dict[str, Any] | None:
    entity_id = row["primary_entity_id"]
    ticker = _ticker_for_entity(entity_id)
    if not ticker:
        return {
            "signalId": row["id"],
            "windowDays": row["predicted_window_days"],
            "forwardReturn": None,
            "outcome": "pending",
            "notes": f"no ticker for entity {entity_id}",
        }
    pub_at = datetime.fromtimestamp(int(row["published_at"]), tz=timezone.utc)
    ret = forward_return(ticker, pub_at, int(row["predicted_window_days"]))
    outcome = classify(row["direction"], ret)
    return {
        "signalId": row["id"],
        "windowDays": row["predicted_window_days"],
        "forwardReturn": ret,
        "outcome": outcome,
        "notes": f"{ticker} pub={pub_at.date()}",
    }


def submit_runs(client: httpx.Client, runs: list[dict[str, Any]]) -> dict[str, Any]:
    if not runs:
        return {"inserted": 0}
    r = client.post(
        f"{_api_base()}/admin/scores",
        headers={
            "Authorization": f"Bearer {_admin_token()}",
            "Content-Type": "application/json",
        },
        json={"runs": runs},
    )
    r.raise_for_status()
    return dict(r.json())


def run() -> dict[str, Any]:
    with httpx.Client(timeout=60.0) as client:
        pending = fetch_pending(client)
        runs = [r for r in (score_one(p) for p in pending) if r is not None]
        result = submit_runs(client, runs)
    return {
        "pending": len(pending),
        "runs_submitted": len(runs),
        "inserted": result.get("inserted", 0),
    }


def main() -> None:
    out = run()
    print(out)


if __name__ == "__main__":
    main()
