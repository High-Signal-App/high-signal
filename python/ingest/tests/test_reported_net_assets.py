from dataclasses import replace
from decimal import Decimal

import pytest

from high_signal_ingest.stock_data.reported_net_assets import (
    MarketObservation,
    ReportedNumber,
    Statement,
    calculate,
)
from high_signal_ingest.stock_data_collectors.nse_financials import (
    parse_statement,
    filing_date,
    filing_url,
)

NOW = "2026-10-29T23:00:00Z"


def number(value, concept="value", context="I", tolerance="0"):
    return ReportedNumber(Decimal(value), Decimal(tolerance), concept, context)


def statement():
    return Statement(
        "TEST",
        "INE123456789",
        "consolidated",
        "2026-09-30",
        NOW,
        "evidence:1",
        number("1000"),
        number("400"),
        number("600"),
        number("100"),
        number("10"),
        number("550"),
        number("50"),
    )


def calculate_for(value=None, **changes):
    return calculate(
        value or statement(),
        market=MarketObservation(
            symbol="TEST",
            isin="INE123456789",
            issued_shares=changes.pop("issued_shares", "10"),
            raw_close=changes.pop("raw_close", "30"),
            price_date="2026-10-28",
            as_of=NOW,
            input_ids=["price:1"],
            **changes,
        ),
    )


def test_decimal_ratio_and_consolidated_nci_label():
    result = calculate_for()
    assert result["marketCap"] == "300"
    assert result["reportedNetAssets"] == "600"
    assert result["ratio"] == "0.5"
    assert result["rankingEligible"]
    assert result["parentEquity"] == "550"
    assert result["label"] == "Market cap / reported net assets"
    assert "not parent-common P/B" in result["warnings"][0]
    assert calculate_for(raw_close="0.1")["marketCap"] == "1.0"


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"issued_shares": "11"}, "master_and_filing_share_count_mismatch"),
        ({"issued_shares": "1.1"}, "invalid_share_quantity_or_face_value"),
        ({"issued_shares": None}, "master_issued_share_quantity_unavailable"),
        ({"raw_close": None}, "raw_close_unavailable"),
        ({"raw_close": "0"}, "nonpositive_raw_close"),
        ({"multiple_classes": True}, "multiple_equity_share_classes"),
    ],
)
def test_unavailable_share_or_price(changes, reason):
    result = calculate_for(**changes)
    assert result["ratio"] is None
    assert result["reason"] == reason
    assert result["reportedNetAssets"] == "600"


def test_rounding_is_tolerance_not_scale():
    s = replace(statement(), capital=number("100", tolerance="0.5"))
    assert calculate_for(s)["ratio"] == "0.5"
    assert calculate_for(replace(s, capital=number("100.4", tolerance="0.5")))["ratio"] == "0.5"
    assert calculate_for(replace(s, capital=number("101", tolerance="0.5")))["ratio"] is None


def test_bad_balance_sheets_identity_and_future_availability_are_rejected():
    for s, reason in [
        (replace(statement(), liabilities=number("401")), "does_not_reconcile"),
        (replace(statement(), equity=number("600", context="other")), "context"),
        (replace(statement(), isin="other"), "identity"),
        (replace(statement(), available_at="2026-10-30T00:00:00Z"), "not_yet_available"),
    ]:
        with pytest.raises(ValueError, match=reason):
            calculate_for(s)


def test_nonpositive_net_assets_and_stale_inputs_do_not_rank():
    s = replace(statement(), assets=number("300"), equity=number("-100"))
    result = calculate_for(s)
    assert result["reportedNetAssets"] == "-100"
    assert result["marketCap"] == "300"
    assert result["ratio"] is None
    assert result["reason"] == "nonpositive_reported_net_assets"
    assert not calculate_for(price_stale=True)["rankingEligible"]
    old = replace(statement(), period_end="2024-03-31")
    assert calculate_for(old)["ratio"] == "0.5"
    assert not calculate_for(old)["rankingEligible"]


def xml(
    namespace="2026-01-31",
    *,
    unit="iso4217:INR",
    scenario="",
    amount="1000",
    liabilities="400",
    equity="600",
    symbol="TEST",
):
    return f"""<x:xbrl xmlns:x="http://www.xbrl.org/2003/instance" xmlns:i="http://www.sebi.gov.in/xbrl/{namespace}/in-capmkt" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrli="http://www.xbrl.org/2003/instance">
    <x:context id="I"><x:entity/><x:period><x:instant>2026-09-30</x:instant></x:period>{scenario}</x:context>
    <x:context id="D"><x:entity/><x:period><x:startDate>2026-07-01</x:startDate><x:endDate>2026-09-30</x:endDate></x:period></x:context>
    <x:unit id="INR"><x:measure>{unit}</x:measure></x:unit>
    <x:unit id="PS"><x:divide><x:unitNumerator><x:measure>iso4217:INR</x:measure></x:unitNumerator><x:unitDenominator><x:measure>xbrli:shares</x:measure></x:unitDenominator></x:divide></x:unit>
    <i:Symbol contextRef="D">{symbol}</i:Symbol><i:ISIN contextRef="D">INE123456789</i:ISIN><i:NatureOfReportStandaloneConsolidated contextRef="D">Consolidated</i:NatureOfReportStandaloneConsolidated>
    <i:Assets contextRef="I" unitRef="INR" decimals="-1">{amount}</i:Assets><i:Liabilities contextRef="I" unitRef="INR" decimals="0">{liabilities}</i:Liabilities><i:Equity contextRef="I" unitRef="INR" decimals="0">{equity}</i:Equity>
    <i:PaidUpValueOfEquityShareCapital contextRef="D" unitRef="INR" decimals="0">100</i:PaidUpValueOfEquityShareCapital><i:FaceValueOfEquityShareCapital contextRef="D" unitRef="PS" decimals="INF">10</i:FaceValueOfEquityShareCapital></x:xbrl>""".encode()


def parse(body):
    return parse_statement(
        body, symbol="TEST", isin="INE123456789", evidence_id="evidence:1", available_at=NOW
    )


@pytest.mark.parametrize("version", ["2025-01-31", "2026-01-31", "2026-08-31"])
def test_supported_taxonomies_and_full_rupee_units(version):
    s = parse(xml(version))
    assert s.assets.value == 1000
    assert s.assets.tolerance == 5
    assert s.capital.value / s.face_value.value == 10
    assert calculate_for(s)["ratio"] == "0.5"


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (xml("2027-01-31"), "taxonomy"),
        (xml(unit="iso4217:USD"), "unit"),
        (xml(scenario="<x:scenario/>"), "balance_sheet_unavailable"),
        (xml(symbol="OTHER"), "identity"),
        (b'<!DOCTYPE x [<!ENTITY value "1000">]>' + xml(), "unsafe"),
        (xml(amount="10000"), "reconcile"),
    ],
)
def test_untrusted_or_incompatible_filings_are_not_values(body, reason):
    with pytest.raises(ValueError, match=reason):
        parse(body)


def test_index_dates_and_original_url_validation():
    assert filing_date("30-SEP-2026").date().isoformat() == "2026-09-30"
    assert filing_date("29-Oct-2026 21:04:19").day == 29
    assert filing_url({"xbrl": "https://evil.test/corporate/xbrl/a.xml"}) is None
    assert filing_url({"xbrl": "https://nsearchives.nseindia.com/corporate/xbrl/a.xml"})


def test_qname_units_cannot_spoof_currency_namespace_and_scale_is_rejected():
    with pytest.raises(ValueError, match="unit"):
        parse(
            xml().replace(
                b'xmlns:iso4217="http://www.xbrl.org/2003/iso4217"',
                b'xmlns:iso4217="https://evil.test/units"',
            )
        )
    with pytest.raises(ValueError, match="scale"):
        parse(xml().replace(b'decimals="-1"', b'decimals="-1" scale="6"'))


def test_retained_projection_joins_identity_preserves_missing_rows_and_gates_availability(tmp_path):
    import hashlib
    import json
    from .test_nse_daily import files, compressed
    from high_signal_ingest.stock_data_collectors.nse import build_archive, digest, write_archive
    from high_signal_ingest.stock_data_collectors.nse_financials import project
    from high_signal_ingest.stock_data.store import StockStore

    master, prices = files()
    for rows in (master, prices):
        rows[0]["TckrSymb"] = "TEST"
        rows[0]["ISIN"] = "INE123456789"
    for row in master:
        row["IssdCptl"] = "10"
    from datetime import date

    day = date(2026, 10, 27)
    manifest, objects = build_archive(*compressed(master, prices), day, "2026-10-27T15:00:00Z")
    archive = tmp_path / "archive"
    path = write_archive(archive, manifest, objects)
    (archive / "latest.json").write_text(
        json.dumps(
            {
                "contractVersion": manifest["contractVersion"],
                "manifestKey": str(path.relative_to(archive)),
                "manifestSha256": digest(path.read_bytes()),
                "tradeDate": day.isoformat(),
                "snapshotId": manifest["snapshotId"],
                "availableAt": manifest["availableAt"],
            }
        )
    )
    cache = tmp_path / "xml"
    cache.mkdir()
    source = cache / "test.xml"
    source.write_bytes(xml())
    source.with_suffix(".xml.meta.json").write_text(
        json.dumps({"observedAt": NOW, "sha256": hashlib.sha256(xml()).hexdigest()})
    )
    index = tmp_path / "index.json"
    filing = {
        "symbol": "TEST",
        "consolidated": "Consolidated",
        "qe_Date": "30-SEP-2026",
        "broadcast_Date": "29-Oct-2026 12:00:00",
        "creation_Date": "29-Oct-2026 12:01:00",
        "seq_Id": "1",
        "xbrl": "https://nsearchives.nseindia.com/corporate/xbrl/test.xml",
    }
    index.write_text(json.dumps({"data": [filing], "totalCount": 1}))

    def bind_index():
        index.with_suffix(".json.meta.json").write_text(
            json.dumps(
                {
                    "observedAt": NOW,
                    "url": "https://www.nseindia.com/api/integrated-filing-results",
                    "sha256": hashlib.sha256(index.read_bytes()).hexdigest(),
                }
            )
        )

    bind_index()
    with StockStore(tmp_path / "store.sqlite") as store:
        output = project(root=archive, indexes=[index], xml_cache=cache, store=store, as_of=NOW)
        assert len(output["rows"]) == len(master)
        ratio = next(r["financials"] for r in output["rows"] if r["symbol"] == "TEST")
        assert ratio["ratio"] == "0.205"
        assert ratio["marketCap"] == "123.00"
        assert ratio["evidence"]["sha256"] == hashlib.sha256(xml()).hexdigest()
        assert (
            ratio["evidence"]["declaredPublicationDates"]["broadcast_Date"]
            == "2026-10-29T12:00:00+05:30"
        )
        assert store.evidence_bytes(ratio["evidence"]["id"]) == xml()
        assert store.facts(as_of="2026-10-28T23:00:00Z") == []
        assert output["coverage"]["status"] == "partial"
        filing["broadcast_Date"] = "30-Oct-2026 12:00:00"
        index.write_text(json.dumps({"data": [filing], "totalCount": 1}))
        bind_index()
        future = project(root=archive, indexes=[index], xml_cache=cache, store=store, as_of=NOW)
        assert future["coverage"]["supportedRatios"] == 0
        assert any(
            f["reason"] == "declared_publication_not_yet_available" for f in future["failures"]
        )
        source.write_bytes(xml(amount="2000", equity="1600"))
        corrupt = project(root=archive, indexes=[index], xml_cache=cache, store=store, as_of=NOW)
        assert any(f["reason"] == "retained_cache_hash_mismatch" for f in corrupt["failures"])


def test_rejected_index_cross_checks_never_enter_the_fact_ledger(tmp_path):
    from high_signal_ingest.stock_data.store import StockStore
    from high_signal_ingest.stock_data_collectors.nse_financials import (
        retain_statement,
        FilingExpectations,
    )

    for expected, reason in [
        (FilingExpectations("2026-06-30", "consolidated", {}), "date_mismatch"),
        (FilingExpectations("2026-09-30", "standalone", {}), "basis_mismatch"),
    ]:
        with StockStore(tmp_path / (reason + ".sqlite")) as store:
            with pytest.raises(ValueError, match=reason):
                retain_statement(
                    store,
                    xml(),
                    "https://nsearchives.nseindia.com/corporate/xbrl/test.xml",
                    symbol="TEST",
                    isin="INE123456789",
                    observed=NOW,
                    expectations=expected,
                )
            assert store.facts(as_of=NOW) == []
            assert store.connection.execute("SELECT COUNT(*) FROM evidence").fetchone()[0] == 1


def test_cache_writer_binds_bytes_and_missing_or_tampered_metadata_is_rejected(tmp_path):
    from high_signal_ingest.stock_data_collectors.nse_financials import cache_metadata, write_cache

    path = tmp_path / "filing.xml"
    path.write_bytes(xml())
    with pytest.raises(ValueError, match="provenance_missing"):
        cache_metadata(path)
    write_cache(path, xml(), "https://nsearchives.nseindia.com/corporate/xbrl/test.xml")
    assert cache_metadata(path)["bytes"] == len(xml())
    path.write_bytes(xml(amount="2000"))
    with pytest.raises(ValueError, match="hash_mismatch"):
        cache_metadata(path)


def test_invalid_index_row_is_a_coverage_failure_not_a_batch_failure(tmp_path):
    import json
    from high_signal_ingest.stock_data.store import StockStore
    from high_signal_ingest.stock_data_collectors.nse_financials import (
        _index_filings,
        write_cache,
        cache_metadata,
    )

    index = tmp_path / "index.json"
    rows = [
        {
            "symbol": "TEST",
            "xbrl": "https://nsearchives.nseindia.com/corporate/xbrl/test.xml",
            "qe_Date": "",
        }
    ]
    write_cache(
        index,
        json.dumps({"data": rows}).encode(),
        "https://www.nseindia.com/api/integrated-filing-results",
    )
    with StockStore(tmp_path / "store.sqlite") as store:
        filings, _, counts = _index_filings([index], store, cache_metadata(index)["observedAt"])
        assert not filings
        assert counts["invalidIndexRows"] == 1
        assert counts["duplicateIndexRows"] == 0


@pytest.mark.parametrize("state", ["interrupted", "tampered", "invalid_timestamp"])
def test_online_refresh_recovers_incomplete_or_invalid_cache(tmp_path, state):
    import httpx
    from datetime import datetime, timezone
    from high_signal_ingest.stock_data.store import StockStore
    from high_signal_ingest.stock_data_collectors.nse_financials import (
        FilingProjection,
        write_cache,
        cache_metadata,
    )

    url = "https://nsearchives.nseindia.com/corporate/xbrl/test.xml"
    path = tmp_path / "test.xml"
    if state in {"tampered", "invalid_timestamp"}:
        write_cache(path, xml(), url)
    path.write_bytes(b"interrupted-or-altered-body")
    if state == "invalid_timestamp":
        import json

        meta_path = path.with_suffix(".xml.meta.json")
        meta = json.loads(meta_path.read_text())
        meta["observedAt"] = 123
        meta_path.write_text(json.dumps(meta))
    requests = []

    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(200, content=xml())

    now = datetime.now(timezone.utc).isoformat()
    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as client,
        StockStore(tmp_path / "store.sqlite") as store,
    ):
        projection = FilingProjection(store, {}, tmp_path, {}, [], [], None, now, client)
        statement, _, _ = projection.read_filing(
            {"xbrl": url, "qe_Date": "30-SEP-2026", "consolidated": "Consolidated"},
            "TEST",
            "INE123456789",
        )
        assert statement.assets.value == 1000
        assert requests == [url]
        assert path.read_bytes() == xml()
        assert cache_metadata(path)["bytes"] == len(xml())
        assert len(projection.integrity_events) == 1
        assert projection.integrity_events[0]["url"] == url
        assert projection.integrity_events[0]["snapshotId"].startswith("snapshot:")


def test_failed_atomic_replacement_preserves_old_body_and_cleans_its_temporary_file(
    tmp_path, monkeypatch
):
    from high_signal_ingest.stock_data_collectors import nse_financials

    path = tmp_path / "filing.xml"
    path.write_bytes(b"old")

    def fail(*_):
        raise OSError("simulated replace failure")

    monkeypatch.setattr(nse_financials.os, "replace", fail)
    with pytest.raises(OSError, match="simulated"):
        nse_financials._atomic_cache_file(path, b"new")
    assert path.read_bytes() == b"old"
    assert list(tmp_path.glob("*.pending")) == []


def test_preview_financial_contract_rejects_other_price_snapshots_dates_and_security_identity(
    tmp_path,
):
    import json
    import runpy
    from pathlib import Path

    helpers = runpy.run_path(
        str(Path(__file__).resolve().parents[3] / "scripts/prepare-stock-dashboard-preview.py")
    )
    path = tmp_path / "financials.json"
    manifest = {"snapshotId": "nse:1", "tradeDate": "2026-10-28"}
    packet = {
        "contractVersion": "stock-data.reported-net-assets.v1",
        "inputSnapshotId": "nse:1",
        "tradeDate": "2026-10-28",
        "rows": [],
    }
    path.write_text(json.dumps(packet))
    assert helpers["financial_projection"](path, manifest) == packet
    assert helpers["financial_projection"](None, manifest) is None
    for key, wrong in [("inputSnapshotId", "nse:other"), ("tradeDate", "2026-10-27")]:
        path.write_text(json.dumps({**packet, key: wrong}))
        with pytest.raises(ValueError, match="does not match"):
            helpers["financial_projection"](path, manifest)
    with pytest.raises(ValueError, match="identity mismatch"):
        helpers["preview_row"](
            {"symbol": "TEST", "isin": "INE123"}, {}, {"symbol": "OTHER", "isin": "INE123"}
        )
