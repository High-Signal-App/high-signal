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
        target.connection.execute(
            "CREATE TEMP TABLE replication_chunks(id TEXT PRIMARY KEY,body BLOB NOT NULL)"
        )
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
