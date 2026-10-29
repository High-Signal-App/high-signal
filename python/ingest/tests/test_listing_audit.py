from copy import deepcopy

import pytest

from high_signal_ingest.stock_data.listing_audit import build_audit, validate_audit


def audit():
    references = {
        "mainboard": b"SYMBOL, ISIN NUMBER, DATE OF LISTING\nBHEL,INE257A01026,28-Oct-2026\nJISLDVREQS,IN9175A01010,28-Oct-2026\nFUTURE,INE467B01029,30-Oct-2026\n",
        "sme": b"SYMBOL,ISIN_NUMBER,DATE_OF_LISTING\nRAVITA,INE1UEL01023,22-Oct-26\n",
    }
    rows = [
        {"symbol": symbol, "isin": isin}
        for symbol, isin in [
            ("BHEL", "INE257A01026"),
            ("JISLDVREQS", "IN9175A01010"),
            ("RAVITA", "INE1UEL01023"),
        ]
    ]
    return build_audit(
        rows, references, snapshot_id="nse:1", session="2026-10-28", observed="2026-10-29T16:00:00Z"
    )


def test_listing_coverage_retains_dvr_and_sme_and_excludes_future_listings():
    result = audit()
    assert result["listedEquityEntries"] == result["matched"] == 3
    assert result["references"][0]["futureListings"] == 1
    assert result["references"][1]["listedBySession"] == 1
    validate_audit(result, {"snapshotId": "nse:1", "tradeDate": "2026-10-28"})


@pytest.mark.parametrize(
    "key,value",
    [
        ("matched", 4),
        ("matched", -1),
        ("matched", True),
        ("listedEquityEntries", 7),
        ("priceSnapshotId", "nse:other"),
    ],
)
def test_invalid_coverage_counts_or_snapshot_are_rejected(key, value):
    result = audit()
    result[key] = value
    with pytest.raises(ValueError):
        validate_audit(result, {"snapshotId": "nse:1", "tradeDate": "2026-10-28"})


@pytest.mark.parametrize(
    "key,value", [("sha256", "unknown"), ("url", "https://example.com/filing"), ("matched", 0)]
)
def test_invalid_reference_evidence_is_rejected(key, value):
    result = deepcopy(audit())
    result["references"][0][key] = value
    with pytest.raises(ValueError):
        validate_audit(result, {"snapshotId": "nse:1", "tradeDate": "2026-10-28"})
