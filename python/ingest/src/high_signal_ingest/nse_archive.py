"""Private NSE archive transport over the existing Wrangler/R2 infrastructure.

Original files and normalized datasets are immutable; latest is promoted only
following byte-for-byte receipt verification. No raw market data enters Git.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

from .stock_data_collectors.nse import (
    PREFIX,
    VERSION,
    digest,
    encoded,
    expected_session,
    read_prices,
)

BUCKET = "high-signal-reddit-archive"
FILES = {"securities.csv.gz", "bhavcopy.csv.zip", "normalized.json.gz", "prices.json.gz"}
KEY_PATTERN = re.compile(
    r"stock-data/nse/v1/sessions/\d{4}-\d{2}-\d{2}/[a-f0-9]{64}/[a-f0-9]{16}/(securities\.csv\.gz|bhavcopy\.csv\.zip|normalized\.json\.gz|prices\.json\.gz|manifest\.json)"
)


def checked_key(key: str) -> str:
    if not KEY_PATTERN.fullmatch(key):
        raise ValueError("Invalid NSE archive object key")
    return key


class R2:
    def get(self, key: str, target: Path, *, optional: bool = False) -> bool:
        target.parent.mkdir(parents=True, exist_ok=True)
        return self._run("get", key, target, optional)

    def put(self, key: str, source: Path) -> None:
        self._run("put", key, source, False)

    @staticmethod
    def _run(operation: str, key: str, path: Path, optional: bool) -> bool:
        result = subprocess.run(
            [
                "npx",
                "--yes",
                "wrangler@4.120.0",
                "r2",
                "object",
                operation,
                f"{BUCKET}/{key}",
                "--file",
                str(path),
                "--remote",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            message = result.stdout + result.stderr
            if optional and any(
                marker in message.lower()
                for marker in (
                    "no such key",
                    "nosuchkey",
                    "specified key does not exist",
                    "object does not exist",
                )
            ):
                return False
            raise RuntimeError(f"Private NSE R2 {operation} failed for {key}; latest not advanced")
        return True


def validate_pointer(pointer: dict) -> None:
    if pointer.get("contractVersion") != VERSION or not re.fullmatch(
        r"[a-f0-9]{64}", pointer.get("manifestSha256", "")
    ):
        raise ValueError("Invalid NSE pointer contract or manifest hash")
    key = checked_key(pointer["manifestKey"])
    instant = datetime.fromisoformat(pointer["availableAt"])
    if instant.tzinfo is None:
        raise ValueError("NSE availability requires an explicit timezone")
    parts = key.split("/")
    if parts[4] != pointer["tradeDate"] or pointer["snapshotId"] != f"nse:{parts[5]}":
        raise ValueError("NSE pointer session or snapshot does not match object key")


def load_manifest(root: Path, pointer: dict) -> dict:
    validate_pointer(pointer)
    path = root / pointer["manifestKey"]
    if digest(path.read_bytes()) != pointer["manifestSha256"]:
        raise ValueError("NSE manifest hash mismatch")
    manifest = json.loads(path.read_bytes())
    if (
        manifest.get("contractVersion") != VERSION
        or manifest.get("status") != "complete"
        or manifest["snapshotId"] != pointer["snapshotId"]
        or manifest["tradeDate"] != pointer["tradeDate"]
        or manifest["availableAt"] != pointer["availableAt"]
        or set(manifest["objects"]) != FILES
    ):
        raise ValueError("NSE manifest does not match complete pointer")
    parent = str(Path(pointer["manifestKey"]).parent)
    for name, ref in manifest["objects"].items():
        checked_key(ref["key"])
        if ref["key"] != f"{parent}/{name}" or not re.fullmatch(r"[a-f0-9]{64}", ref["sha256"]):
            raise ValueError("NSE object reference mismatch")
    return manifest


def restore(root: Path, transport: R2, *, optional: bool = False) -> dict | None:
    pending = root / "remote-latest.json"
    if not transport.get(f"{PREFIX}/latest.json", pending, optional=optional):
        return None
    pointer = json.loads(pending.read_bytes())
    validate_pointer(pointer)
    transport.get(pointer["manifestKey"], root / pointer["manifestKey"])
    manifest = load_manifest(root, pointer)
    for ref in manifest["objects"].values():
        local = root / ref["key"]
        transport.get(ref["key"], local)
        if local.stat().st_size != ref["bytes"] or digest(local.read_bytes()) != ref["sha256"]:
            raise ValueError("NSE restored object receipt mismatch")
    read_prices(root, manifest)
    (root / "latest.json").write_bytes(encoded(pointer))
    return manifest


def _previous_pointer(root: Path, transport: R2) -> dict | None:
    path = root / "previous-latest.json"
    if not transport.get(f"{PREFIX}/latest.json", path, optional=True):
        return None
    pointer = json.loads(path.read_bytes())
    validate_pointer(pointer)
    return pointer


def _upload_session(root: Path, transport: R2, pointer: dict, manifest: dict) -> None:
    receipt = root / "receipts"
    for name, ref in manifest["objects"].items():
        local = root / ref["key"]
        if local.stat().st_size != ref["bytes"] or digest(local.read_bytes()) != ref["sha256"]:
            raise ValueError("NSE local object hash mismatch")
        transport.put(ref["key"], local)
        remote = receipt / name
        transport.get(ref["key"], remote)
        if digest(remote.read_bytes()) != ref["sha256"]:
            raise ValueError("NSE uploaded object receipt mismatch")
    key = pointer["manifestKey"]
    transport.put(key, root / key)
    transport.get(key, receipt / "manifest.json")
    if digest((receipt / "manifest.json").read_bytes()) != pointer["manifestSha256"]:
        raise ValueError("NSE uploaded manifest receipt mismatch")


def _promote(root: Path, transport: R2, pointer: dict, previous: dict | None) -> dict:
    path = root / "promotion.json"
    path.write_bytes(encoded(pointer))
    try:
        transport.put(f"{PREFIX}/latest.json", path)
        remote = root / "receipts" / "latest.json"
        transport.get(f"{PREFIX}/latest.json", remote)
        if json.loads(remote.read_bytes()) != pointer:
            raise ValueError("NSE latest pointer receipt mismatch")
    except Exception:
        # Data objects were already verified. Restore the acknowledged prior
        # pointer if final pointer acknowledgement fails; never delete history.
        if previous is not None:
            transport.put(f"{PREFIX}/latest.json", root / "previous-latest.json")
        raise
    return pointer


def publish(root: Path, transport: R2) -> dict:
    pointer = json.loads((root / "candidate.json").read_bytes())
    manifest = load_manifest(root, pointer)
    previous = _previous_pointer(root, transport)
    if previous and previous["snapshotId"] == pointer["snapshotId"]:
        return previous  # preserve first-observed availability on current retries
    # Backfills always persist. Only promotion is skipped for older sessions or
    # previously superseded versions. Known writers serialize across branches.
    _upload_session(root, transport, pointer, manifest)
    if previous:
        if previous["tradeDate"] > pointer["tradeDate"]:
            return previous
        if previous["tradeDate"] == pointer["tradeDate"]:
            prior = previous.get("priorVersions", [])
            if any(item["snapshotId"] == pointer["snapshotId"] for item in prior):
                return previous
            if datetime.fromisoformat(previous["availableAt"]) > datetime.fromisoformat(
                pointer["availableAt"]
            ):
                return previous
            pointer["priorVersions"] = [
                *prior,
                {k: v for k, v in previous.items() if k != "priorVersions"},
            ]
    return _promote(root, transport, pointer, previous)


def consume(root: Path, *, as_of: str | None = None, allow_stale: bool = False) -> dict:
    pointer = json.loads((root / "latest.json").read_bytes())
    manifest = load_manifest(root, pointer)
    dataset = read_prices(root, manifest, as_of=as_of)
    age = (
        datetime.now(timezone.utc).date() - datetime.fromisoformat(manifest["tradeDate"]).date()
    ).days
    if not allow_stale and (age < 0 or age > 4):
        raise ValueError("NSE canonical inputs are stale or future dated")
    dataset["freshness"] = freshness(manifest["tradeDate"])
    return dataset


def freshness(trade_date: str, now: datetime | None = None) -> dict:
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Asia/Kolkata"))
    expected = expected_session(local)
    current = expected.isoformat() <= trade_date <= local.date().isoformat()
    return {
        "status": "fresh" if current else "stale",
        "expectedSession": expected.isoformat(),
        "observedSession": trade_date,
        "basis": "weekday publication deadline; holidays unconfirmed; never relabel a prior session",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("restore", "publish", "consume"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--optional", action="store_true")
    parser.add_argument(
        "--allow-stale",
        action="store_true",
        help="retain/query dated inputs without claiming freshness",
    )
    args = parser.parse_args()
    if args.operation == "publish":
        pointer = publish(args.root, R2())
        # Consume exactly the acknowledged version, including idempotent retries.
        (args.root / "latest.json").write_bytes(encoded(pointer))
        restore(args.root, R2())
    elif args.operation == "restore":
        if restore(args.root, R2(), optional=args.optional) is None:
            print("NSE archive not initialized")
            return
    dataset = consume(args.root, allow_stale=args.allow_stale or args.operation == "publish")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.out.with_suffix(".tmp")
        temporary.write_bytes(encoded(dataset))
        temporary.replace(args.out)
    print(
        json.dumps(
            {
                "snapshotId": dataset["snapshotId"],
                "tradeDate": dataset["economicDate"],
                "securities": len(dataset["rows"]),
                "reportedPrices": sum(r["rawClose"] is not None for r in dataset["rows"]),
                "freshness": dataset["freshness"],
            }
        )
    )


if __name__ == "__main__":
    main()
