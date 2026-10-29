"""Full-market collection and durable publication boundaries, without exchange I/O."""

import csv
import gzip
import io
import json
import zipfile
from datetime import date
from pathlib import Path

import httpx
import pytest

from high_signal_ingest.stock_data_collectors.nse import (
    PREFIX,
    build_archive,
    collect,
    digest,
    encoded,
    parse_files,
    read_prices,
    write_archive,
)
from high_signal_ingest.nse_archive import consume, publish, restore

DAY = date(2026, 10, 27)
OBSERVED = "2026-10-27T15:00:00+00:00"


def csv_bytes(rows):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def files(count=4, traded=3, day=DAY):
    master = [
        {
            "FinInstrmId": str(i),
            "ISIN": f"INE{i:06d}010",
            "TckrSymb": f"CO{i}",
            "SctySrs": ["EQ", "SM", "BE", "ST"][i % 4],
            "DelFlg": "N",
            "FinInstrmNm": f"Company {i}",
        }
        for i in range(count)
    ]
    prices = [
        {
            **{k: v for k, v in row.items() if k not in ("DelFlg", "FinInstrmNm")},
            "TradDt": day.isoformat(),
            "Src": "NSE",
            "Sgmt": "CM",
            "ClsPric": "12.30",
            "TtlTradgVol": "0" if i == 0 else "500",
        }
        for i, row in enumerate(master[:traded])
    ]
    return master, prices


def compressed(master, prices, day=DAY):
    zipped = io.BytesIO()
    with zipfile.ZipFile(zipped, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"BhavCopy_NSE_CM_0_0_0_{day:%Y%m%d}_F_0000.csv", csv_bytes(prices))
    return gzip.compress(csv_bytes(master), mtime=0), zipped.getvalue()


def candidate(root, observed=OBSERVED, count=4, traded=3, close="12.30", day=DAY):
    master_rows, price_rows = files(count, traded, day=day)
    price_rows[0]["ClsPric"] = close
    master, prices = compressed(master_rows, price_rows, day=day)
    manifest, objects = build_archive(master, prices, day, observed)
    path = write_archive(root, manifest, objects)
    pointer = {
        "contractVersion": manifest["contractVersion"],
        "manifestKey": str(path.relative_to(root)),
        "manifestSha256": digest(path.read_bytes()),
        "tradeDate": day.isoformat(),
        "snapshotId": manifest["snapshotId"],
        "availableAt": observed,
    }
    (root / "candidate.json").write_bytes(encoded(pointer))
    return manifest, pointer


class MemoryR2:
    def __init__(self):
        self.objects = {}
        self.corrupt = None

    def get(self, key, target, *, optional=False):
        if key not in self.objects and optional:
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"corrupted" if self.corrupt == key else self.objects[key])
        return True

    def put(self, key, source):
        self.objects[key] = source.read_bytes()


def test_every_master_and_series_retained_without_inventing_prices(tmp_path):
    manifest, _ = candidate(tmp_path)
    dataset = read_prices(tmp_path, manifest)
    assert len(dataset["rows"]) == 4
    assert {r["series"] for r in dataset["rows"]} == {"EQ", "SM", "BE", "ST"}
    missing = next(r for r in dataset["rows"] if r["priceStatus"] == "not_reported")
    assert missing["rawClose"] is None and missing["last_date"] is None
    zero_volume = dataset["rows"][0]
    assert zero_volume["rawClose"] == "12.30" and zero_volume["traded"] is False
    assert all(
        r["adjustedClose"] is None and r["priceBasis"] == "unadjusted" for r in dataset["rows"]
    )
    assert manifest["counts"] == {"securities": 4, "observations": 3, "withoutObservation": 1}
    assert dataset["rights"]["publicDisplay"] == "unknown"


@pytest.mark.parametrize(
    "fault", ["date", "exchange", "orphan", "identity", "duplicate", "negative", "nan"]
)
def test_bad_exchange_files_rejected(fault):
    master, prices = files()
    if fault == "date":
        prices[0]["TradDt"] = "2026-10-26"
    if fault == "exchange":
        prices[0]["Src"] = "BSE"
    if fault == "orphan":
        prices[0]["FinInstrmId"] = "9999"
    if fault == "identity":
        prices[0]["ISIN"] = "DIFFERENT"
    if fault == "duplicate":
        prices.append(dict(prices[0]))
    if fault == "negative":
        prices[0]["ClsPric"] = "-1"
    if fault == "nan":
        prices[0]["ClsPric"] = "NaN"
    with pytest.raises(ValueError):
        parse_files(*compressed(master, prices), DAY)


def test_same_version_and_values_are_reproducible():
    inputs = compressed(*files())
    first, first_objects = build_archive(*inputs, DAY, OBSERVED)
    second, second_objects = build_archive(*inputs, DAY, OBSERVED)
    assert first == second and first_objects == second_objects


def test_historical_availability_and_tamper_protection(tmp_path):
    manifest, _ = candidate(tmp_path)
    with pytest.raises(ValueError, match="not available"):
        read_prices(tmp_path, manifest, as_of="2026-10-27T14:59:59+00:00")
    assert read_prices(tmp_path, manifest, as_of=OBSERVED)["rows"]
    (tmp_path / manifest["objects"]["prices.json.gz"]["key"]).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="hash mismatch"):
        read_prices(tmp_path, manifest)


def test_receipt_failure_never_advances_latest(tmp_path):
    manifest, _ = candidate(tmp_path)
    transport = MemoryR2()
    transport.objects[f"{PREFIX}/latest.json"] = b"old pointer"
    # First publish validates the previous pointer before any mutation.
    with pytest.raises(json.JSONDecodeError):
        publish(tmp_path, transport)
    del transport.objects[f"{PREFIX}/latest.json"]
    transport.corrupt = manifest["objects"]["bhavcopy.csv.zip"]["key"]
    with pytest.raises(ValueError, match="receipt mismatch"):
        publish(tmp_path, transport)
    assert f"{PREFIX}/latest.json" not in transport.objects


def test_retry_keeps_first_observed_version_and_restore_is_complete(tmp_path):
    transport = MemoryR2()
    manifest, pointer = candidate(tmp_path / "first")
    assert publish(tmp_path / "first", transport) == pointer
    candidate(tmp_path / "retry", "2026-10-28T15:00:00+00:00")
    assert publish(tmp_path / "retry", transport) == pointer
    restored = restore(tmp_path / "restored", transport)
    assert restored == manifest
    assert consume(tmp_path / "restored", allow_stale=True)["availableAt"] == OBSERVED


def test_entire_market_does_not_enter_per_security_d1_ledger(tmp_path):
    manifest, _ = candidate(tmp_path, count=38_225, traded=3_670)
    dataset = read_prices(tmp_path, manifest)
    assert len(dataset["rows"]) == 38_225
    assert sum(r["rawClose"] is not None for r in dataset["rows"]) == 3_670
    assert not list(tmp_path.rglob("*.sqlite"))
    assert sum(ref["bytes"] for ref in manifest["objects"].values()) < 10_000_000


def test_failed_refresh_preserves_candidate_and_latest(tmp_path):
    _, pointer = candidate(tmp_path)
    (tmp_path / "latest.json").write_bytes(encoded(pointer))
    before = (tmp_path / "candidate.json").read_bytes()
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(404)))
    with pytest.raises(httpx.HTTPStatusError):
        collect(tmp_path, DAY, client=client, observed=OBSERVED)
    assert (tmp_path / "candidate.json").read_bytes() == before
    assert json.loads((tmp_path / "latest.json").read_bytes()) == pointer


def test_existing_price_consumers_receive_underlying_nse_rows(tmp_path):
    from high_signal_ingest.equities_daily import merge_nse_inputs

    root = tmp_path / "stock-data" / "nse"
    _, pointer = candidate(root)
    (root / "latest.json").write_bytes(encoded(pointer))
    base = {
        "rows": [],
        "snapshotId": "non-nse:1",
        "coverage": {},
        "rights": {"publicDisplay": "permitted", "export": "permitted"},
    }
    result = merge_nse_inputs(base, tmp_path)
    assert len(result["rows"]) == 4
    observed = next(r for r in result["rows"] if r["rawClose"] is not None)
    assert observed["rawClose"] == "12.30" and observed["sourceRefs"]
    assert result["nseInputSnapshotId"] == pointer["snapshotId"]
    assert result["rights"]["publicDisplay"] == "unknown"


def test_backfill_is_retained_even_after_a_later_session(tmp_path):
    transport = MemoryR2()
    # A newer session pointer exists. The old archive must still be uploaded.
    _, newer = candidate(tmp_path / "newer", "2026-10-28T15:00:00+00:00", day=date(2026, 10, 28))
    transport.objects[f"{PREFIX}/latest.json"] = encoded(newer)
    manifest, _ = candidate(tmp_path / "backfill")
    assert publish(tmp_path / "backfill", transport) == newer
    assert all(ref["key"] in transport.objects for ref in manifest["objects"].values())
    assert json.loads(transport.objects[f"{PREFIX}/latest.json"]) == newer


def test_superseded_bytes_cannot_reassert_after_same_day_correction(tmp_path):
    transport = MemoryR2()
    _, original = candidate(tmp_path / "original")
    publish(tmp_path / "original", transport)
    _, revised = candidate(tmp_path / "revised", "2026-10-27T16:00:00+00:00", close="12.31")
    promoted = publish(tmp_path / "revised", transport)
    assert promoted["snapshotId"] == revised["snapshotId"]
    candidate(tmp_path / "reappearance", "2026-10-27T17:00:00+00:00")
    assert publish(tmp_path / "reappearance", transport) == promoted
    assert promoted["priorVersions"][0]["snapshotId"] == original["snapshotId"]


def test_failed_pointer_acknowledgement_restores_previous_pointer(tmp_path):
    transport = MemoryR2()
    _, previous = candidate(tmp_path / "first")
    publish(tmp_path / "first", transport)
    candidate(tmp_path / "next", "2026-10-27T16:00:00+00:00", close="12.31")
    original_get = transport.get
    reads = 0

    def get(key, target, **kwargs):
        nonlocal reads
        if key == f"{PREFIX}/latest.json":
            reads += 1
            if reads == 2:
                raise RuntimeError("pointer receipt network failure")
        return original_get(key, target, **kwargs)

    transport.get = get
    with pytest.raises(RuntimeError, match="receipt network failure"):
        publish(tmp_path / "next", transport)
    assert json.loads(transport.objects[f"{PREFIX}/latest.json"]) == previous


def test_schedule_uses_closed_indian_session_for_late_utc_retry():
    from datetime import datetime
    from high_signal_ingest.stock_data_collectors.nse import expected_session
    from high_signal_ingest.nse_archive import freshness

    # 21:30 UTC is already the following date in India.
    assert expected_session(datetime.fromisoformat("2026-10-27T21:30:00+00:00")) == DAY
    assert expected_session(datetime.fromisoformat("2026-10-27T13:30:00+00:00")) == DAY
    saturday = datetime.fromisoformat("2026-10-31T12:00:00+00:00")
    assert expected_session(saturday) == date(2026, 10, 30)
    assert freshness("2026-10-26", datetime.fromisoformat(OBSERVED))["status"] == "stale"


def test_global_ingress_does_not_fetch_nse_again(tmp_path, monkeypatch):
    from high_signal_ingest import equities_daily
    from high_signal_ingest.sources.equities.universe import TickerSpec
    from high_signal_ingest.sources.equities.snapshot import Close

    monkeypatch.setattr(
        equities_daily,
        "build_universe",
        lambda: [
            TickerSpec("BHEL.NS", "BHEL", "NS", "equity"),
            TickerSpec("AAPL.US", "AAPL", "US", "equity"),
        ],
    )

    def fetch(tickers, **kwargs):
        assert all(not symbol.endswith(".NS") for symbol in tickers)
        return {"AAPL.US": [Close(20261027, 10)]}

    monkeypatch.setattr(equities_daily, "yf_fetch_many", fetch)
    equities_daily.run_daily(out_path=tmp_path / "prices.jsonl")


def test_nse_cli_rejects_partial_company_limits():
    from high_signal_ingest.equities_daily import main

    with pytest.raises(SystemExit) as error:
        main(["--market", "nse", "--limit", "20"])
    assert error.value.code == 2
