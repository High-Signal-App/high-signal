from __future__ import annotations

from datetime import datetime, timezone

import pytest

from high_signal_ingest.sources.equities.snapshot import Close
from high_signal_ingest.sources.equities.universe import TickerSpec
from high_signal_ingest.stock_data import SourceRights, StockStore
from high_signal_ingest.stock_data_collectors.sec_xbrl import normalize_companyfacts
from high_signal_ingest.stock_data_prices import persist_prices, versioned_prices
from high_signal_ingest.stock_data_research import research_events

NOW = "2026-10-29T20:00:00Z"
THEN = "2026-10-28T20:00:00Z"


def permit(store, source="sec-xbrl"):
    store.put_rights(
        SourceRights(
            source,
            "https://example.org/licence",
            "permitted",
            "permitted",
            "prohibited",
            reviewed_at=NOW,
        )
    )


def companyfacts(value=100, filed="2026-10-28"):
    return {
        "cik": 1,
        "entityName": "Fixture issuer",
        "facts": {
            "us-gaap": {
                "Assets": {
                    "units": {
                        "USD": [
                            {
                                "val": value,
                                "end": "2026-09-30",
                                "filed": filed,
                                "accn": "0001-26-000001",
                                "form": "10-Q",
                            }
                        ]
                    }
                }
            },
            "dei": {
                "EntityCommonStockSharesOutstanding": {
                    "units": {
                        "shares": [
                            {
                                "val": 200,
                                "end": "2026-09-30",
                                "filed": filed,
                                "accn": "0001-26-000001",
                                "form": "10-Q",
                            }
                        ]
                    }
                }
            },
        },
    }


def test_filing_to_facts_changes_editorial_evidence_and_rights(tmp_path):
    with StockStore(tmp_path / "stock.sqlite") as store:
        permit(store)
        first = normalize_companyfacts(
            "issuer", "0000000001", companyfacts(), store, ingested_at=NOW
        )
        assert {f.metric for f in first} == {"assets", "shares_outstanding"}
        assert {f.unit for f in first} == {"USD", "shares"}
        assert (
            store.dataset(as_of=THEN, audience="display")["facts"] == []
        )  # filing day ends after this time
        current = store.dataset(as_of=NOW, audience="display", freshness_days=550)
        events = research_events(None, current)
        assert len(events) == 1  # multiple rows from one original cannot manufacture corroboration
        assert {e.source_url for e in events} == {
            "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json"
        }
        assert all(e.source_document.raw_json["investmentConclusion"] is None for e in events)
        assert all(
            e.source_document.raw_json["inputSnapshotId"] == current["snapshot_id"] for e in events
        )
        assert research_events(current, current) == []
        later = store.dataset(as_of="2026-10-30T20:00:00Z", audience="display", freshness_days=550)
        assert [e.id for e in research_events(None, later)] == [e.id for e in events]
        assert store.dataset(as_of=NOW, audience="export")["facts"] == []
        store.put_rights(
            SourceRights("sec-xbrl", "https://example.org/licence", public_display="prohibited")
        )
        assert store.dataset(as_of=NOW, audience="display")["withheld_sources"] == ["sec-xbrl"]


def test_price_ingress_retains_history_and_retries_do_not_duplicate(tmp_path):
    spec = TickerSpec("BHEL.NS", "BHEL", "NS", "equity", currency="INR", country="IN")
    closes = [
        Close(20261027, 10, provider_close=12, split_ratio=2),
        Close(20261028, 11, provider_close=13),
    ]
    with StockStore(tmp_path / "stock.sqlite") as store:
        with store.transaction():
            ids = persist_prices(store, spec, closes, ingested_at=NOW)
        assert len(ids) == 5
        assert persist_prices(store, spec, closes, ingested_at="2026-10-30T20:00:00Z") == []
        history = store.historical_closes("BHEL.NS", "2026-10-27", "2026-10-29")
        assert [r["close"] for r in history] == [10, 11]
        assert store.historical_closes("BHEL.NS", "2026-10-27", "2026-10-29", known_at=THEN) == []
        assert store.dataset(as_of=NOW, audience="display")["facts"] == []
        revised = [Close(20261027, 9, provider_close=12, split_ratio=2), closes[1]]
        assert len(persist_prices(store, spec, revised, ingested_at="2026-10-30T20:00:00Z")) == 1
        assert (
            store.historical_closes("BHEL.NS", "2026-10-27", "2026-10-29", known_at=NOW)[0]["close"]
            == 10
        )
        assert store.historical_closes("BHEL.NS", "2026-10-27", "2026-10-29")[0]["close"] == 9


def test_return_history_never_masquerades_as_nominal_prices(tmp_path):
    spec = TickerSpec("BHEL.NS", "BHEL", "NS", "equity", currency="INR", country="IN")
    with StockStore(tmp_path / "stock.sqlite") as store:
        persist_prices(store, spec, [Close(20261028, 11, provider_close=13)], ingested_at=NOW)
        assert {f.metric for f in store.facts(as_of=NOW)} == {"adjusted_close", "provider_close"}
    rows = [
        {
            "ticker": "BHEL.NS",
            "last_close": 11,
            "last_date": 20261028,
            "inputSnapshotIds": ["snapshot:retained-inputs"],
        }
    ]
    a = versioned_prices(rows, generated_at=NOW, history_available=True)
    b = versioned_prices(rows, generated_at=THEN, history_available=True)
    assert a["snapshotId"] == b["snapshotId"]
    assert a["rows"][0]["priceBasis"] == "total_return_adjusted"
    assert a["rights"]["publicDisplay"] == "unknown"


def test_latest_sec_units_and_periods_are_not_silently_combined(tmp_path):
    payload = companyfacts()
    payload["facts"]["us-gaap"]["Assets"]["units"]["EUR"] = [
        {"val": 80, "end": "2026-09-30", "filed": "2026-10-28", "accn": "0001-26-000002"}
    ]
    payload["facts"]["us-gaap"]["Assets"]["units"]["USD"].append(
        {"val": 999, "end": "2026-09-30", "filed": "2026-10-30", "accn": "0001-26-000003"}
    )
    with StockStore(tmp_path / "stock.sqlite") as store:
        facts = normalize_companyfacts("issuer", "0000000001", payload, store, ingested_at=NOW)
        assert {(f.unit, f.value) for f in facts if f.metric == "assets"} == {
            ("USD", "100"),
            ("EUR", "80"),
        }


def test_backtest_requires_complete_retained_window(tmp_path, monkeypatch):
    from high_signal_ingest.score import backtest

    path = tmp_path / "prices.sqlite"
    monkeypatch.setattr(backtest, "stock_store_path", lambda: path)
    spec = TickerSpec("BHEL.NS", "BHEL", "NS", "equity", currency="INR", country="IN")
    with StockStore(path) as store:
        persist_prices(store, spec, [Close(20260101, 10), Close(20260102, 11)], ingested_at=NOW)
    assert backtest.forward_return("BHEL.NS", datetime(2026, 1, 1, tzinfo=timezone.utc), 3) is None
    assert backtest.forward_return("BHEL.NS", datetime(2026, 1, 1, tzinfo=timezone.utc), 1) is None
    with StockStore(path) as store:
        permit(store, "yahoo-finance")
    assert backtest.forward_return(
        "BHEL.NS", datetime(2026, 1, 1, tzinfo=timezone.utc), 1
    ) == pytest.approx(10)


def test_private_replication_rehydrates_evidence_and_rolls_back_bad_records(tmp_path):
    from high_signal_ingest.stock_data.replication import records, import_record
    from high_signal_ingest.stock_data import Fact

    with (
        StockStore(tmp_path / "source.sqlite") as source,
        StockStore(tmp_path / "replica.sqlite") as target,
    ):
        permit(source)
        document = source.retain_evidence(
            source_id="sec-xbrl",
            url="https://example.org/filing",
            body=b"x" * 600_000,
            available_at=THEN,
            ingested_at=NOW,
        )
        original = Fact("issuer", "assets", "100", "USD", THEN, THEN, NOW, document.id, "/assets")
        source.put_fact(original)
        packet = list(records(source))
        for record in packet:
            import_record(target, record)
        assert target.evidence_bytes(document.id) == b"x" * 600_000
        assert target.facts(as_of=NOW)[0].id == original.id
        corrupt = next(record for record in packet if record["kind"] == "fact")
        corrupt = {**corrupt, "payload": {**corrupt["payload"], "value": "999"}}
        with pytest.raises(ValueError, match="identity"):
            import_record(target, corrupt)
        assert len(target.facts(as_of=NOW)) == 1


def test_revocation_cannot_leak_previous_numbers_through_change_records(tmp_path):
    from high_signal_ingest.stock_data_refresh import materialize

    with StockStore(tmp_path / "facts.sqlite") as store:
        permit(store)
        normalize_companyfacts("issuer", "0000000001", companyfacts(), store, ingested_at=NOW)
        previous = materialize(store, as_of=NOW)
        assert previous["facts"]
        store.put_rights(
            SourceRights("sec-xbrl", "https://example.org/licence", public_display="prohibited")
        )
        current = materialize(store, as_of=NOW, previous=previous)
        assert current["facts"] == [] and current["changes"] == [] and current["evidence"] == []


def test_filing_amendment_replaces_one_economic_series_and_retains_both_proofs(tmp_path):
    from high_signal_ingest.stock_data_refresh import materialize

    with StockStore(tmp_path / "facts.sqlite") as store:
        permit(store)
        normalize_companyfacts("issuer", "0000000001", companyfacts(), store, ingested_at=NOW)
        previous = materialize(store, as_of=NOW)
        amended = companyfacts(120, filed="2026-10-29")
        amended["facts"]["us-gaap"]["Assets"]["units"]["USD"][0]["accn"] = "0001-26-000002"
        later = "2026-10-30T20:00:00Z"
        normalize_companyfacts("issuer", "0000000001", amended, store, ingested_at=later)
        current = materialize(store, as_of=later, previous=previous)
        assert [fact["value"] for fact in current["facts"] if fact["metric"] == "assets"] == ["120"]
        change = next(change for change in current["changes"] if change["metric"] == "assets")
        assert change["before"]["value"] == "100" and change["after"]["value"] == "120"
        evidence = {doc["id"] for doc in current["evidence"]}
        assert (
            change["before"]["evidence_id"] in evidence
            and change["after"]["evidence_id"] in evidence
        )


def test_price_and_filing_facts_use_the_existing_company_identity(tmp_path):
    spec = TickerSpec("NVDA.US", "NVDA", "US", "equity", currency="USD", country="US")
    with StockStore(tmp_path / "stock.sqlite") as store:
        persist_prices(store, spec, [Close(20261028, 11, provider_close=13)], ingested_at=NOW)
        normalize_companyfacts("NVDA", "0000000001", companyfacts(), store, ingested_at=NOW)
        facts = store.facts(as_of=NOW, entity_id="NVDA")
        assert {f.metric for f in facts} >= {"adjusted_close", "assets", "shares_outstanding"}
        assert store.identities("security")[0]["entity_id"] == "NVDA"
        persist_prices(store, spec, [Close(20261029, 12)], ingested_at="2026-10-30T20:00:00Z")
        assert store.identities()[0]["identifiers"]["cik"] == "0000000001"
        assert (
            store.connection.execute(
                "SELECT count(*) FROM evidence WHERE source_id='yahoo-finance'"
            ).fetchone()[0]
            == 2
        )


def test_rights_reversion_needs_a_new_dated_decision(tmp_path):
    from dataclasses import replace
    from high_signal_ingest.stock_data.replication import import_record

    initial = SourceRights("test", "https://example.org/terms")
    allowed = replace(initial, public_display="permitted", reviewed_at=NOW)
    with StockStore(tmp_path / "stock.sqlite") as store:
        store.put_rights(initial)
        store.put_rights(allowed)
        with pytest.raises(ValueError, match="newly dated"):
            store.put_rights(initial)
        assert store.rights("test") == allowed
        # Retrying historical replication must not reorder the rights log.
        from dataclasses import asdict

        import_record(
            store, {"kind": "rights", "id": initial.version_id, "payload": asdict(initial)}
        )
        assert store.rights("test") == allowed
        revoked = replace(initial, reviewed_at="2026-10-30T00:00:00Z")
        store.put_rights(revoked)
        assert not store.rights("test").allows("display")


def test_current_contract_is_bounded_by_reported_period_but_history_remains(tmp_path):
    payload = companyfacts()
    rows = payload["facts"]["us-gaap"]["Assets"]["units"]["USD"]
    rows.append(
        {**rows[0], "val": 80, "end": "2026-06-30", "filed": "2026-07-30", "accn": "0001-26-000000"}
    )
    with StockStore(tmp_path / "stock.sqlite") as store:
        normalize_companyfacts("issuer", "0000000001", payload, store, ingested_at=NOW)
        current = store.dataset(as_of=NOW, audience="display", freshness_days=550)
        assert [f["value"] for f in current["facts"] if f["metric"] == "assets"] == ["100"]
        historical = store.dataset(
            as_of="2026-08-01T00:00:00Z", audience="display", freshness_days=550
        )
        assert [f["value"] for f in historical["facts"] if f["metric"] == "assets"] == ["80"]
        assert len(store.facts(as_of=NOW, metric="assets")) == 2


def test_current_projection_preserves_distinct_reporting_durations(tmp_path):
    payload = companyfacts()
    payload["facts"]["us-gaap"]["Revenues"] = {
        "units": {
            "USD": [
                {
                    "val": 10,
                    "start": "2026-07-01",
                    "end": "2026-09-30",
                    "filed": "2026-10-28",
                    "accn": "0001-26-000001",
                },
                {
                    "val": 30,
                    "start": "2026-01-01",
                    "end": "2026-09-30",
                    "filed": "2026-10-28",
                    "accn": "0001-26-000001",
                },
            ]
        }
    }
    with StockStore(tmp_path / "stock.sqlite") as store:
        normalize_companyfacts("issuer", "0000000001", payload, store, ingested_at=NOW)
        current = store.dataset(as_of=NOW, audience="display", freshness_days=550)
        assert {f["value"] for f in current["facts"] if f["metric"] == "revenue"} == {"10", "30"}


def test_ecb_refresh_preserves_a_newer_operator_rights_decision(tmp_path):
    from high_signal_ingest.stock_data_collectors.ecb import retain_rates, POLICY

    body = b'<Envelope><Cube><Cube time="2026-10-29"><Cube currency="INR" rate="100"/></Cube></Cube></Envelope>'
    with StockStore(tmp_path / "stock.sqlite") as store:
        retain_rates(store, body, ingested_at=NOW)
        revoked = SourceRights("ecb-fx", POLICY, public_display="prohibited", reviewed_at=NOW)
        store.put_rights(revoked)
        retain_rates(store, body, ingested_at="2026-10-30T20:00:00Z")
        assert store.rights("ecb-fx") == revoked
        assert store.dataset(as_of=NOW, audience="display")["facts"] == []


def test_replication_budget_fails_before_the_first_remote_append(tmp_path, monkeypatch):
    from high_signal_ingest.stock_data import replication

    class NoWrites:
        def post(self, *args, **kwargs):
            raise AssertionError("budget exceeded before any append was permitted")

    with StockStore(tmp_path / "stock.sqlite") as store:
        normalize_companyfacts("issuer", "0000000001", companyfacts(), store, ingested_at=NOW)
        monkeypatch.setattr(replication, "MAX_RECORDS", 1)
        with pytest.raises(ValueError, match="pilot inventory budget"):
            replication.replicate(store, NoWrites(), set())


def test_scheduled_prices_do_not_implicitly_retain_six_years(tmp_path, monkeypatch):
    import json
    from high_signal_ingest import equities_daily

    spec = TickerSpec("AAPL.US", "AAPL", "US", "equity", currency="USD", country="US")
    monkeypatch.setattr(equities_daily, "build_universe", lambda: [spec])
    monkeypatch.setattr(
        equities_daily,
        "yf_fetch_many",
        lambda *args, **kwargs: {
            "AAPL.US": [Close(20261028, 10)],
            "SPY.US": [Close(20261028, 100)],
        },
    )
    equities_daily.run_daily(out_path=tmp_path / "prices.jsonl")
    with StockStore(tmp_path / "stock-data/stock-data.sqlite") as store:
        assert store.facts(as_of="2099-01-01T00:00:00Z") == []
    manifest = json.loads((tmp_path / "stock-data-prices.json").read_text())
    assert not manifest["historyAvailable"] and manifest["completeness"] == "unavailable"
    assert manifest["rows"][0].get("last_close") is None
    with pytest.raises(ValueError, match="at most 20"):
        equities_daily.run_daily(
            period="6y", retain_history=True, out_path=tmp_path / "prices.jsonl"
        )
    monkeypatch.setattr(equities_daily, "build_universe", lambda: [spec] * 21)
    with pytest.raises(ValueError, match="at most 20"):
        equities_daily.run_daily(
            period="1mo", retain_history=True, out_path=tmp_path / "prices.jsonl"
        )


def test_conflicting_listing_cannot_abort_other_pilot_tickers(tmp_path, monkeypatch):
    import json
    from high_signal_ingest import equities_daily
    from high_signal_ingest.stock_data import Entity, Security

    nvda = TickerSpec("NVDA.US", "NVDA", "US", "equity", currency="USD", country="US")
    bhel = TickerSpec("AAPL.US", "AAPL", "US", "equity", currency="USD", country="US")
    with StockStore(tmp_path / "stock-data/stock-data.sqlite") as store:
        store.put_entity(Entity("old-NVDA", "Earlier mapping", "US"))
        store.put_security(Security("security:NVDA.US", "old-NVDA", "NVDA.US", "USD"))
    monkeypatch.setattr(equities_daily, "build_universe", lambda: [nvda, bhel])
    monkeypatch.setattr(
        equities_daily,
        "yf_fetch_many",
        lambda *args, **kwargs: {
            symbol: [Close(20261028, 10)] for symbol in ("NVDA.US", "AAPL.US", "SPY.US")
        },
    )
    equities_daily.run_daily(period="1mo", retain_history=True, out_path=tmp_path / "prices.jsonl")
    rows = json.loads((tmp_path / "stock-data-prices.json").read_text())["rows"]
    assert next(row for row in rows if row["ticker"] == "NVDA.US")["identityStatus"] == "conflict"
    assert next(row for row in rows if row["ticker"] == "AAPL.US")["last_close"] == 10


def test_replication_accounts_for_restored_history_before_adding_new_records(tmp_path, monkeypatch):
    from high_signal_ingest.stock_data import replication

    class NoWrites:
        def post(self, *args, **kwargs):
            raise AssertionError("total inventory exceeds budget before a new append")

    with StockStore(tmp_path / "stock.sqlite") as store:
        normalize_companyfacts("issuer", "0000000001", companyfacts(), store, ingested_at=NOW)
        inventory = {record["id"]: record for record in replication.records(store)}
        known = set(list(inventory)[:-1])
        monkeypatch.setattr(replication, "MAX_RECORDS", len(inventory) - 1)
        with pytest.raises(ValueError, match="pilot inventory budget"):
            replication.replicate(store, NoWrites(), known)
        monkeypatch.setattr(replication, "MAX_RECORDS", 100000)
        monkeypatch.setattr(
            replication,
            "MAX_TRANSFER_BYTES",
            sum(replication._record_cost(record) for record in inventory.values()) - 1,
        )
        with pytest.raises(ValueError, match="pilot inventory budget"):
            replication.replicate(store, NoWrites(), known)


def test_restore_distinguishes_unprovisioned_history_from_operational_failures(tmp_path):
    import httpx
    from high_signal_ingest.stock_data import replication

    for status in (404, 401, 500):

        class Client:
            def get(self, path):
                return httpx.Response(
                    status, request=httpx.Request("GET", "https://example.org" + path)
                )

        with StockStore(tmp_path / f"{status}.sqlite") as store:
            exception = (
                replication.HistoryNotProvisioned if status == 404 else httpx.HTTPStatusError
            )
            with pytest.raises(exception):
                replication.restore(store, Client())


def test_orphan_evidence_chunks_survive_restore_close_and_reopen(tmp_path):
    import base64
    import hashlib
    import httpx
    import json
    from high_signal_ingest.stock_data import Entity, replication

    body = b"chunk uploaded before an interrupted evidence batch"
    orphan = {
        "kind": "blob",
        "id": "blob:" + hashlib.sha256(body).hexdigest(),
        "payload": {"base64": base64.b64encode(body).decode()},
    }

    class Client:
        def get(self, path):
            return httpx.Response(
                200,
                json={"records": [orphan] if path.endswith("=0") else [], "cursor": 1},
                request=httpx.Request("GET", "https://example.org" + path),
            )

        def post(self, path, *, json):
            return httpx.Response(
                200,
                json={"accepted": [record["id"] for record in json["records"]]},
                request=httpx.Request("POST", "https://example.org" + path),
            )

    path = tmp_path / "restored.sqlite"
    known_file = tmp_path / "known.json"
    with StockStore(path) as store:
        known_file.write_text(json.dumps(sorted(replication.restore(store, Client()))))
    with StockStore(path) as store:
        known = set(json.loads(known_file.read_text()))
        assert orphan in list(replication.records(store))
        store.put_entity(Entity("new-company", "New company", "IN"))
        assert replication.replicate(store, Client(), known) == 1
        assert orphan["id"] in known
