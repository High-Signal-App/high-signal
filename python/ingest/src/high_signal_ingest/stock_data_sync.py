"""Operator-authenticated history restore and atomic public-head publication."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import httpx

from .stock_data.replication import HistoryNotProvisioned, replicate, restore
from .stock_data.store import StockStore
from .stock_data_prices import stock_store_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("restore", "publish"))
    parser.add_argument("--store", type=Path, default=stock_store_path())
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
    api, token = os.environ.get("API_BASE"), os.environ.get("ADMIN_TOKEN")
    if not api or not token:
        raise SystemExit("Private stock history requires the existing operator API credentials")
    known_path = args.store.with_suffix(".known.json")
    with (
        StockStore(args.store) as store,
        httpx.Client(
            base_url=api.rstrip("/"), headers={"Authorization": f"Bearer {token}"}, timeout=60
        ) as client,
    ):
        if args.operation == "restore":
            if store.connection.execute("SELECT count(*) FROM facts").fetchone()[0]:
                raise SystemExit(
                    "Restore requires an empty local ledger; existing work is preserved"
                )
            known = restore(store, client)
            known_path.write_text(json.dumps(sorted(known)))
            if args.snapshot:
                response = client.get("/admin/stock-data/publications/current")
                response.raise_for_status()
                args.snapshot.parent.mkdir(parents=True, exist_ok=True)
                args.snapshot.write_text(json.dumps(response.json()))
            print(json.dumps({"restored_records": len(known)}))
        else:
            if not args.snapshot or not known_path.exists():
                raise SystemExit(
                    "Restore private history and materialize a snapshot before publication"
                )
            known = set(json.loads(known_path.read_text()))
            count = replicate(store, client, known)
            payload = json.loads(args.snapshot.read_text())
            response = client.post("/admin/stock-data/publications", json=payload)
            response.raise_for_status()
            expected = [payload[audience]["publication_id"] for audience in ("display", "export")]
            if response.json().get("accepted") != expected:
                raise RuntimeError("Stock publication was not fully acknowledged")
            known_path.write_text(json.dumps(sorted(known)))
            print(json.dumps({"retained_records": count, "publications": expected}))


if __name__ == "__main__":
    try:
        main()
    except HistoryNotProvisioned as exc:
        print(str(exc))
        raise SystemExit(78) from exc
