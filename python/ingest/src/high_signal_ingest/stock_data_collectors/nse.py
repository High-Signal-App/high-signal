"""Official full-market NSE files, called only by the canonical equities ingress.

The complete security master (including inactive/test instruments) and every
cash-market bhavcopy row are retained. Collection coverage is not valuation or
redistribution permission. No adjusted prices are manufactured from raw closes.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import re
import zipfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

BASE = "https://nsearchives.nseindia.com/content/cm"
POLICY = "https://www.nseindia.com/static/market-data/nse-data-policy"
VERSION = "stock-data.nse-daily.v1"
EXTRACTOR_VERSION = "nse-cm.v2"
PREFIX = "stock-data/nse/v1"
MAX_BYTES = 80_000_000


def encoded(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def urls(day: date) -> dict[str, str]:
    return {
        "bhavcopy": f"{BASE}/BhavCopy_NSE_CM_0_0_0_{day:%Y%m%d}_F_0000.csv.zip",
        "securities": f"{BASE}/NSE_CM_security_{day:%d%m%Y}.csv.gz",
    }


def _csv(body: bytes, required: set[str]) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    if not required.issubset(reader.fieldnames or []) or len(reader.fieldnames or []) != len(
        set(reader.fieldnames or [])
    ):
        raise ValueError("NSE schema changed or response is not the expected CSV")
    rows = list(reader)
    if not rows or any(None in r or any(v is None for v in r.values()) for r in rows):
        raise ValueError("Empty, truncated or malformed NSE CSV")
    return rows


def parse_files(master: bytes, bhavcopy: bytes, day: date) -> tuple[list[dict], list[dict]]:
    # Bound decompression before materializing untrusted archive contents.
    with gzip.GzipFile(fileobj=io.BytesIO(master)) as stream:
        securities = stream.read(MAX_BYTES + 1)
    if len(securities) > MAX_BYTES:
        raise ValueError("NSE master exceeds decompression budget")
    with zipfile.ZipFile(io.BytesIO(bhavcopy)) as archive:
        members = archive.infolist()
        expected = f"BhavCopy_NSE_CM_0_0_0_{day:%Y%m%d}_F_0000.csv"
        if len(members) != 1 or members[0].filename != expected or members[0].file_size > MAX_BYTES:
            raise ValueError("Unexpected NSE bhavcopy archive member")
        prices = archive.read(members[0])
    master_rows = _csv(securities, {"FinInstrmId", "ISIN", "TckrSymb", "SctySrs", "DelFlg"})
    price_rows = _csv(
        prices,
        {
            "FinInstrmId",
            "ISIN",
            "TckrSymb",
            "SctySrs",
            "TradDt",
            "Src",
            "Sgmt",
            "ClsPric",
            "TtlTradgVol",
        },
    )
    master_by_id = _unique(master_rows)
    _unique(price_rows)
    for row in price_rows:
        if row["TradDt"] != day.isoformat() or row["Src"] != "NSE" or row["Sgmt"] != "CM":
            raise ValueError("NSE trade date, exchange or segment mismatch")
        parent = master_by_id.get(row["FinInstrmId"])
        if parent is None or any(parent[k] != row[k] for k in ("ISIN", "TckrSymb", "SctySrs")):
            raise ValueError("NSE bhavcopy instrument missing or conflicting in dated master")
        for field in (
            "ClsPric",
            "OpnPric",
            "HghPric",
            "LwPric",
            "PrvsClsgPric",
            "TtlTradgVol",
            "TtlTrfVal",
            "TtlNbOfTxsExctd",
        ):
            _number(row.get(field, ""))
    return master_rows, price_rows


def _unique(rows: list[dict]) -> dict[str, dict]:
    result = {}
    for row in rows:
        key = row["FinInstrmId"]
        if not key or not row["TckrSymb"] or not row["SctySrs"] or key in result:
            raise ValueError("Duplicate or empty NSE instrument identity")
        result[key] = row
    return result


def _number(value: str) -> str | None:
    if not value.strip():
        return None
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid NSE numeric value") from exc
    if not number.is_finite() or number < 0:
        raise ValueError("Non-finite or negative NSE price/quantity")
    return str(number)


def _price_row(
    master: dict, price: dict | None, day: date, snapshot: str, refs: list, observed: str
) -> dict:
    symbol, series = master["TckrSymb"], master["SctySrs"]
    close = _number(price["ClsPric"]) if price else None
    # A zero-volume official close is retained, but is not an executed trade.
    volume = _number(price["TtlTradgVol"]) if price else None
    row = {
        "ticker": f"{symbol}.NS" if series == "EQ" else f"{symbol}.{series}.NS",
        "symbol": symbol,
        "series": series,
        "exchange": "NSE",
        "country": "IN",
        "currency": "INR",
        "name": master.get("FinInstrmNm"),
        "entityId": f"issuer:nse-symbol:{symbol}",
        "identityStatus": "provisional_listing_identity",
        "securityId": f"security:nse:{master['FinInstrmId']}:{master['ISIN']}",
        "isin": master["ISIN"],
        "instrumentId": master["FinInstrmId"],
        "deleted": master["DelFlg"] == "Y",
        "testInstrument": "NSETEST" in symbol.upper() or "DUMMY" in master["ISIN"].upper(),
        "identifierValid": bool(re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", master["ISIN"])),
        "priceBasis": "unadjusted",
        "adjustedClose": None,
        "last_close": float(close) if close is not None else None,
        "rawClose": close,
        "volume": volume,
        "last_date": int(day.strftime("%Y%m%d")) if close is not None else None,
        "priceStatus": "reported" if close is not None else "not_reported",
        "traded": Decimal(volume) > 0 if volume is not None else False,
        "completeness": "partial" if price else "unavailable",
        "effectiveAt": f"{day.isoformat()}T15:30:00+05:30",
        "availableAt": observed,
        "ingestedAt": observed,
        "inputSnapshotIds": [snapshot],
        "sourceRefs": refs,
        "sourceLocator": f"FinInstrmId={master['FinInstrmId']}",
    }
    row["inputSnapshotId"] = "price-row:" + digest(encoded(row))
    return row


def build_archive(
    master: bytes, bhavcopy: bytes, day: date, observed: str
) -> tuple[dict, dict[str, bytes]]:
    master_rows, price_rows = parse_files(master, bhavcopy, day)
    sources = urls(day)
    source_hashes = {"securities": digest(master), "bhavcopy": digest(bhavcopy)}
    # Same bytes + extractor => same numerical snapshot. Availability is the first
    # observed time of this version, not a guessed historical publication time.
    snapshot = "nse:" + digest(
        encoded([VERSION, EXTRACTOR_VERSION, day.isoformat(), source_hashes])
    )
    refs = [{"sourceId": "nse-cm", "url": url} for url in sources.values()]
    prices = {r["FinInstrmId"]: r for r in price_rows}
    rows = [
        _price_row(r, prices.get(r["FinInstrmId"]), day, snapshot, refs, observed)
        for r in sorted(master_rows, key=lambda r: r["FinInstrmId"])
    ]
    dataset = {
        "contractVersion": "stock-data.prices.v1",
        "snapshotId": snapshot,
        "generatedAt": observed,
        "availableAt": observed,
        "ingestedAt": observed,
        "economicDate": day.isoformat(),
        "completeness": "partial",
        "universeComplete": False,
        "marketUniverseComplete": True,
        "historyAvailable": False,
        "coverage": {
            "scope": "entire NSE CM security master and final bhavcopy; all series",
            "securityMaster": "complete",
            "bhavcopy": "complete",
            "adjustedHistory": "unavailable; corporate actions not normalized",
            "ownership": "unavailable",
            "financials": "unavailable",
        },
        "rights": {"publicDisplay": "unknown", "export": "unknown", "policyUrl": POLICY},
        "rows": rows,
    }
    normalized = {
        "contractVersion": VERSION,
        "snapshotId": snapshot,
        "securities": master_rows,
        "observations": price_rows,
    }
    objects = {
        "securities.csv.gz": master,
        "bhavcopy.csv.zip": bhavcopy,
        "normalized.json.gz": gzip.compress(encoded(normalized), mtime=0),
        "prices.json.gz": gzip.compress(encoded(dataset), mtime=0),
    }
    prefix = f"{PREFIX}/sessions/{day.isoformat()}/{snapshot.split(':')[1]}/{digest(observed.encode())[:16]}"
    manifest = {
        "contractVersion": VERSION,
        "snapshotId": snapshot,
        "status": "complete",
        "tradeDate": day.isoformat(),
        "availableAt": observed,
        "ingestedAt": observed,
        "availabilityBasis": "first_observed_not_historical_publication",
        "extractorVersion": EXTRACTOR_VERSION,
        "sourceUrls": sources,
        "sourceSha256": source_hashes,
        "counts": {
            "securities": len(master_rows),
            "observations": len(price_rows),
            "withoutObservation": len(master_rows) - len(price_rows),
        },
        "series": sorted({r["SctySrs"] for r in master_rows}),
        "rights": dataset["rights"],
        "objects": {
            name: {"key": f"{prefix}/{name}", "sha256": digest(body), "bytes": len(body)}
            for name, body in objects.items()
        },
    }
    return manifest, objects


def write_archive(root: Path, manifest: dict, objects: dict[str, bytes]) -> Path:
    prefix = Path(next(iter(manifest["objects"].values()))["key"]).parent
    destination = root / prefix
    destination.mkdir(parents=True, exist_ok=True)
    for name, body in objects.items():
        (destination / name).write_bytes(body)
    (destination / "manifest.json").write_bytes(encoded(manifest))
    return destination / "manifest.json"


def read_prices(root: Path, manifest: dict, *, as_of: str | None = None) -> dict:
    if as_of is not None and datetime.fromisoformat(
        manifest["availableAt"]
    ) > datetime.fromisoformat(as_of):
        raise ValueError("NSE snapshot was not available at requested historical time")
    ref = manifest["objects"]["prices.json.gz"]
    path = Path(ref["key"])
    if path.is_absolute() or ".." in path.parts or not str(path).startswith(PREFIX + "/"):
        raise ValueError("Invalid private NSE archive key")
    body = (root / path).read_bytes()
    if digest(body) != ref["sha256"]:
        raise ValueError("NSE archive object hash mismatch")
    dataset = json.loads(gzip.decompress(body))
    if dataset["snapshotId"] != manifest["snapshotId"]:
        raise ValueError("NSE dataset snapshot mismatch")
    return dataset


def _download(client: httpx.Client, url: str) -> bytes:
    with client.stream("GET", url) as response:
        response.raise_for_status()
        body = bytearray()
        for chunk in response.iter_bytes():
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise ValueError("NSE response exceeds download budget")
    return bytes(body)


def collect(
    root: Path, day: date, *, client: httpx.Client | None = None, observed: str | None = None
) -> Path:
    observed = observed or datetime.now(timezone.utc).isoformat()
    if day > datetime.fromisoformat(observed).date():
        raise ValueError("Future NSE session requested")
    owns_client = client is None
    client = client or httpx.Client(
        timeout=45,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        sources = urls(day)
        master = _download(client, sources["securities"])
        bhavcopy = _download(client, sources["bhavcopy"])
    finally:
        if owns_client:
            client.close()
    manifest, objects = build_archive(master, bhavcopy, day, observed)
    if manifest["counts"]["securities"] < 1000 or manifest["counts"]["observations"] < 1000:
        raise ValueError("Suspiciously small full NSE file; preserve last good archive")
    path = write_archive(root, manifest, objects)
    # Candidate only. Remote latest advances only after every upload is read back.
    candidate = {
        "contractVersion": VERSION,
        "manifestKey": str(path.relative_to(root)),
        "manifestSha256": digest(path.read_bytes()),
        "tradeDate": day.isoformat(),
        "snapshotId": manifest["snapshotId"],
        "availableAt": observed,
    }
    root.mkdir(parents=True, exist_ok=True)
    (root / "candidate.json").write_bytes(encoded(candidate))
    return path


def previous_weekday(day: date) -> date:
    day -= timedelta(days=1)
    while day.weekday() > 4:
        day -= timedelta(days=1)
    return day


def expected_session(now: datetime | None = None) -> date:
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Asia/Kolkata"))
    day = local.date()
    return previous_weekday(day) if day.weekday() > 4 or local.hour < 19 else day
