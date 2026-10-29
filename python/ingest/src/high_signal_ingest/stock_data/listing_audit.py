"""Reproducible coverage check against retained official main-board and SME lists."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

from ..nse_archive import consume, load_manifest
from .models import canonical_json, instant

SOURCES = {
    "mainboard": "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
    "sme": "https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv",
}


def reference_entries(body: bytes, board: str, session: str) -> tuple[set, int, int]:
    if len(body) > 5_000_000:
        raise ValueError("listing_reference_exceeds_budget")
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    entries, total, future = set(), 0, 0
    for raw in reader:
        row = {
            key.strip().replace(" ", "_"): value.strip()
            for key, value in raw.items()
            if key and value is not None
        }
        symbol, isin = row["SYMBOL"], row["ISIN_NUMBER"]
        if not symbol or not re.fullmatch(r"IN[A-Z0-9]{9}[0-9]", isin):
            raise ValueError("invalid_listing_reference_identity")
        listed = datetime.strptime(
            row["DATE_OF_LISTING"], "%d-%b-%Y" if board == "mainboard" else "%d-%b-%y"
        ).date()
        total += 1
        if listed > date.fromisoformat(session):
            future += 1
        else:
            entries.add((symbol, isin))
    if not total:
        raise ValueError("empty_listing_reference")
    return entries, total, future


def build_audit(
    rows: list[dict], references: dict[str, bytes], *, snapshot_id: str, session: str, observed: str
) -> dict:
    instant(observed)
    retained = {(row["symbol"], row["isin"]) for row in rows}
    groups, sources = {}, []
    for board, url in SOURCES.items():
        body = references[board]
        wanted, total, future = reference_entries(body, board, session)
        groups[board] = wanted
        sources.append(
            {
                "market": board,
                "url": url,
                "sha256": hashlib.sha256(body).hexdigest(),
                "referenceRows": total,
                "listedBySession": len(wanted),
                "matched": len(wanted & retained),
                "missing": sorted(wanted - retained),
                "futureListings": future,
            }
        )
    union = set.union(*groups.values())
    return {
        "contractVersion": "stock-data.listing-audit.v1",
        "priceSnapshotId": snapshot_id,
        "tradeDate": session,
        "observedAt": observed,
        "listedEquityEntries": len(union),
        "matched": len(union & retained),
        "overlap": len(groups["mainboard"] & groups["sme"]),
        "references": sources,
    }


def _count(value: object) -> int:
    if type(value) is not int or value < 0:
        raise ValueError("invalid_listing_audit_count")
    return value


def validate_audit(audit: dict, manifest: dict) -> None:
    if (
        audit.get("contractVersion") != "stock-data.listing-audit.v1"
        or audit.get("priceSnapshotId") != manifest["snapshotId"]
        or audit.get("tradeDate") != manifest["tradeDate"]
    ):
        raise ValueError("Universe audit does not match the retained price snapshot")
    instant(audit["observedAt"])
    listed, matched = _count(audit["listedEquityEntries"]), _count(audit["matched"])
    references = audit["references"]
    if (
        len(references) != 2
        or {row["market"] for row in references} != set(SOURCES)
        or matched > listed
    ):
        raise ValueError("invalid_listing_audit_references")
    for row in references:
        if row["url"] != SOURCES[row["market"]] or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"]):
            raise ValueError("invalid_listing_audit_source")
        expected, actual = _count(row["listedBySession"]), _count(row["matched"])
        if (
            actual > expected
            or actual + len(row["missing"]) != expected
            or _count(row["referenceRows"]) != expected + _count(row["futureListings"])
        ):
            raise ValueError("inconsistent_listing_audit_reference_counts")
    overlap = _count(audit["overlap"])
    total_matched = sum(row["matched"] for row in references)
    if (
        listed != sum(row["listedBySession"] for row in references) - overlap
        or not total_matched - overlap <= matched <= total_matched
    ):
        raise ValueError("inconsistent_listing_audit_totals")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "mainboard", "sme", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    private = Path(__file__).resolve().parents[5] / ".fleet-local"
    output = args.out.resolve()
    if not output.is_relative_to(private):
        raise ValueError("Listing audit output must stay under ignored .fleet-local")
    pointer = json.loads((args.root / "latest.json").read_text())
    manifest = load_manifest(args.root, pointer)
    dataset = consume(args.root, allow_stale=True)
    audit = build_audit(
        dataset["rows"],
        {board: getattr(args, board).read_bytes() for board in SOURCES},
        snapshot_id=manifest["snapshotId"],
        session=manifest["tradeDate"],
        observed=datetime.now(timezone.utc).isoformat(),
    )
    validate_audit(audit, manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(audit))
    output.chmod(0o600)
    print(
        canonical_json({key: audit[key] for key in ("listedEquityEntries", "matched", "tradeDate")})
    )


if __name__ == "__main__":
    main()
