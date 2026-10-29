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
    checked_key(pointer["manifestKey"])
    datetime.fromisoformat(pointer["availableAt"])


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


def publish(root: Path, transport: R2) -> dict:
    pointer = json.loads((root / "candidate.json").read_bytes())
    manifest = load_manifest(root, pointer)
    previous_file = root / "previous-latest.json"
    if transport.get(f"{PREFIX}/latest.json", previous_file, optional=True):
        previous = json.loads(previous_file.read_bytes())
        validate_pointer(previous)
        if previous["tradeDate"] > pointer["tradeDate"]:
            raise ValueError("Historical backfill cannot replace latest NSE session")
        if (
            previous["tradeDate"] == pointer["tradeDate"]
            and previous["snapshotId"] != pointer["snapshotId"]
            and datetime.fromisoformat(previous["availableAt"])
            > datetime.fromisoformat(pointer["availableAt"])
        ):
            raise ValueError("Older NSE revision cannot replace a newer observed version")
        if previous["snapshotId"] == pointer["snapshotId"]:
            # Retry of identical inputs must retain first-observed availability.
            return previous
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
    transport.put(f"{PREFIX}/latest.json", root / "candidate.json")
    transport.get(f"{PREFIX}/latest.json", receipt / "latest.json")
    if json.loads((receipt / "latest.json").read_bytes()) != pointer:
        raise ValueError("NSE latest pointer receipt mismatch")
    return pointer


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
    dataset = consume(args.root)
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
            }
        )
    )


if __name__ == "__main__":
    main()
