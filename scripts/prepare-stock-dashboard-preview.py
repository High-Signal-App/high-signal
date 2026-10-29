"""Prepare a private, read-only UI projection of the retained NSE archive. No network I/O."""

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python/ingest/src"))
from high_signal_ingest.nse_archive import consume, load_manifest
from high_signal_ingest.stock_data_collectors.nse import parse_files


def financial_projection(path: Path | None, manifest: dict) -> dict | None:
    financial_packet = json.loads(path.read_text()) if path else None
    if financial_packet and (
        financial_packet.get("contractVersion") != "stock-data.reported-net-assets.v1"
        or financial_packet.get("inputSnapshotId") != manifest["snapshotId"]
        or financial_packet.get("tradeDate") != manifest["tradeDate"]
    ):
        raise ValueError(
            "Financial projection does not match the retained price snapshot"
        )
    return financial_packet


def preview_row(row: dict, price: dict, financial_row: dict | None) -> dict:
    if financial_row and (financial_row["symbol"], financial_row["isin"]) != (
        row["symbol"],
        row["isin"],
    ):
        raise ValueError("Financial projection security identity mismatch")
    return {
        "id": row["securityId"],
        "symbol": row["symbol"],
        "name": row["name"],
        "ticker": row["ticker"],
        "isin": row["isin"],
        "series": row["series"],
        "instrumentId": row["instrumentId"],
        "deleted": row["deleted"],
        "testInstrument": row.get("testInstrument", "NSETEST" in row["symbol"]),
        "identifierValid": row["identifierValid"],
        "close": row["rawClose"],
        "open": price.get("OpnPric") or None,
        "high": price.get("HghPric") or None,
        "low": price.get("LwPric") or None,
        "previousClose": price.get("PrvsClsgPric") or None,
        "volume": price.get("TtlTradgVol") or None,
        "turnover": price.get("TtlTrfVal") or None,
        "trades": price.get("TtlNbOfTxsExctd") or None,
        "inputSnapshotId": row["inputSnapshotId"],
        "financials": financial_row["financials"] if financial_row else None,
    }


def prepare(
    root: Path,
    out: Path,
    financials: Path | None = None,
    universe_audit: Path | None = None,
) -> None:
    private_dir = Path(__file__).resolve().parents[1] / ".fleet-local"
    out = out.resolve()
    if not out.is_relative_to(private_dir):
        raise ValueError(
            "Preview output must stay under the ignored .fleet-local directory"
        )
    pointer = json.loads((root / "latest.json").read_text())
    manifest = load_manifest(root, pointer)
    dataset = consume(root, allow_stale=True)
    bodies = {}
    for name in ("securities.csv.gz", "bhavcopy.csv.zip"):
        ref = manifest["objects"][name]
        body = (root / ref["key"]).read_bytes()
        if hashlib.sha256(body).hexdigest() != ref["sha256"]:
            raise ValueError("Original NSE source hash mismatch")
        bodies[name] = body
    _, observations = parse_files(
        bodies["securities.csv.gz"],
        bodies["bhavcopy.csv.zip"],
        date.fromisoformat(manifest["tradeDate"]),
    )
    prices = {row["FinInstrmId"]: row for row in observations}
    financial_packet = financial_projection(financials, manifest)
    financial_rows = (
        {r["securityId"]: r for r in financial_packet["rows"]}
        if financial_packet
        else {}
    )
    rows = [
        preview_row(
            row,
            prices.get(row["instrumentId"], {}),
            financial_rows.get(row["securityId"]),
        )
        for row in dataset["rows"]
    ]
    payload = {
        "contractVersion": "stock-data.dashboard-preview.v1",
        "snapshotId": manifest["snapshotId"],
        "tradeDate": manifest["tradeDate"],
        "availableAt": manifest["availableAt"],
        "extractorVersion": manifest["extractorVersion"],
        "counts": manifest["counts"],
        "sourceUrls": manifest["sourceUrls"],
        "sourceSha256": manifest["sourceSha256"],
        "rights": manifest["rights"],
        "freshness": dataset["freshness"],
        "rows": rows,
    }
    if financial_packet:
        payload["financialCoverage"] = financial_packet["coverage"]
        payload["financialSnapshotId"] = financial_packet["snapshotId"]
        payload["financialAsOf"] = financial_packet["asOf"]
    if universe_audit:
        audit = json.loads(universe_audit.read_text())
        if (
            audit.get("priceSnapshotId") != manifest["snapshotId"]
            or audit.get("tradeDate") != manifest["tradeDate"]
        ):
            raise ValueError(
                "Universe audit does not match the retained price snapshot"
            )
        payload["universeAudit"] = audit
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
    out.chmod(0o600)
    print(
        json.dumps(
            {
                "path": str(out),
                "records": len(rows),
                "tradeDate": manifest["tradeDate"],
                "rights": manifest["rights"],
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--financials", type=Path)
    parser.add_argument("--universe-audit", type=Path)
    args = parser.parse_args()
    prepare(args.root, args.out, args.financials, args.universe_audit)
