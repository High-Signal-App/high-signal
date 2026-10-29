"""Acceptance checks for the stock-data boundary and economic safeguards."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from decimal import Decimal, localcontext

import pytest

from high_signal_ingest.stock_data import Entity, Fact, Security, SourceRights, StockStore
from high_signal_ingest.stock_data.valuation import (
    FinancialAdjustment,
    ListedHolding,
    OwnershipEdge,
    UnsupportedValuation,
    ValuationComponent,
    ValuationRequest,
    detect_changes,
    evaluate,
    ownership_exposure,
)

NOW = "2026-10-29T20:00:00Z"
DAY = "2026-10-29T00:00:00Z"
OLD = "2026-03-31T00:00:00Z"


def fact(metric="market_cap", value="100", entity="parent", unit="INR", **kwargs):
    defaults = {
        "effective_at": DAY,
        "available_at": DAY,
        "ingested_at": NOW,
        "evidence_id": "evidence:filing",
        "locator": "note 7.5.1",
    }
    defaults.update(kwargs)
    return Fact(entity_id=entity, metric=metric, value=value, unit=unit, **defaults)


def holding(owner="parent", asset="asset", security="security:asset", value="10", price="20"):
    return ListedHolding(
        owner,
        asset,
        security,
        fact(
            "shares_owned",
            value,
            owner,
            "shares",
            dimensions={"security_id": security, "share_basis": "basis-v1"},
        ),
        fact(
            "raw_close",
            price,
            asset,
            dimensions={
                "security_id": security,
                "price_basis": "nominal",
                "share_basis": "basis-v1",
            },
        ),
    )


def edge(owner="parent", asset="sub", fraction="0.5"):
    return OwnershipEdge(
        owner,
        asset,
        fact(
            "ownership_fraction", fraction, owner, "fraction", dimensions={"asset_entity_id": asset}
        ),
    )


def request(**kwargs):
    values = {
        "parent_entity_id": "parent",
        "currency": "INR",
        "as_of": NOW,
        "input_snapshot_ids": ("snapshot:source",),
        "market_cap": fact(),
        "holdings": (holding(),),
    }
    values.update(kwargs)
    return ValuationRequest(**values)


def complete(method="holding_nav"):
    return fact(
        "valuation_scope_complete",
        "1",
        unit="boolean",
        dimensions={"method": method, "accounting_basis": "standalone"},
    )


def test_listed_coverage_is_not_nav_discount():
    result = evaluate(request())
    assert result.value == "200"
    assert result.listed_investment_coverage == "2"
    assert result.discount_to_nav is None
    assert result.ranking_eligible is False
    assert result.input_fact_ids
    assert result.input_snapshot_ids == ("snapshot:source",)


def test_source_backed_complete_nav_is_ranked():
    result = evaluate(
        request(
            method="holding_nav",
            completeness=complete(),
            expected_interest_ids=("listed:parent:security:asset",),
        )
    )
    assert result.value == "200"
    assert result.discount_to_nav == "0.5"
    assert result.ranking_eligible


def test_net_debt_and_cash_cannot_count_the_same_net_assets_twice():
    dimensions = {"accounting_basis": "standalone"}
    adjustments = (
        FinancialAdjustment(
            "net-debt", fact("net_debt", "50", dimensions=dimensions), "parent_obligation"
        ),
        FinancialAdjustment("cash", fact("cash", "20", dimensions=dimensions), "other_net_assets"),
    )
    result = evaluate(request(method="holding_nav", adjustments=adjustments))
    assert result.value is None
    assert any("overlaps" in issue for issue in result.issues)


def test_completeness_is_a_boolean_scope_declaration():
    declaration = replace(complete(), unit="INR")
    result = evaluate(
        request(
            method="holding_nav",
            completeness=declaration,
            expected_interest_ids=("listed:parent:security:asset",),
        )
    )
    assert result.discount_to_nav is None and not result.ranking_eligible


def test_missing_is_not_zero_and_incomplete_nav_not_ranked():
    result = evaluate(request(method="holding_nav"))
    assert result.value == "200"
    assert result.coverage == "partial"
    assert result.discount_to_nav is None
    missing = replace(holding().shares, value=None, status="unavailable")
    result = evaluate(request(holdings=(replace(holding(), shares=missing),)))
    assert result.value is None
    with pytest.raises(ValueError, match="missing"):
        fact(value=None)
    zero = evaluate(request(holdings=(holding(value="0"),)))
    assert zero.value == "0"


def test_indirect_ownership_and_multiple_paths():
    edges = (edge(), edge("sub", "leaf", "0.4"), edge("parent", "leaf", "0.1"))
    exposure = ownership_exposure("parent", edges, NOW)
    assert exposure["leaf"] == Decimal("0.3")
    result = evaluate(request(ownership=edges, holdings=(holding(owner="leaf"),)))
    assert Decimal(result.value) == Decimal("60")


def test_cycles_and_duplicate_ownership_withheld():
    cyclic = (edge(), edge("sub", "parent", "0.2"))
    result = evaluate(request(ownership=cyclic))
    assert result.value is None
    assert any("cycle" in issue or "100%" in issue for issue in result.issues)
    with pytest.raises(UnsupportedValuation, match="duplicate"):
        ownership_exposure("parent", (edge(), edge()), NOW)


def test_intermediate_and_underlying_not_counted_twice():
    result = evaluate(
        request(
            ownership=(edge(), edge("sub", "leaf")),
            holdings=(
                holding(asset="sub", security="sub"),
                holding(owner="sub", asset="leaf", security="leaf"),
            ),
        )
    )
    assert result.value is None
    assert any("overlap" in issue for issue in result.issues)
    duplicate = evaluate(request(holdings=(holding(), holding())))
    assert duplicate.value is None
    assert any("duplicate" in issue for issue in duplicate.issues)


def test_disclosed_holdings_also_prevent_intermediate_double_counting():
    result = evaluate(
        request(
            ownership=(edge(),),
            holdings=(
                holding(asset="sub", security="sub"),
                holding(owner="sub", asset="leaf", security="leaf"),
            ),
        )
    )
    assert result.value is None
    assert any("overlap" in issue for issue in result.issues)


def test_enterprise_debt_requires_the_matching_metric_and_scope():
    component = ValuationComponent(
        "business:sub",
        "sub",
        fact("enterprise_value", "1000", "sub", dimensions={"accounting_basis": "standalone"}),
        "enterprise",
        fact("assets", "200", "sub", dimensions={"accounting_basis": "standalone"}),
    )
    for debt in (
        component.net_debt,
        fact("net_debt", "200", "sub", dimensions={"accounting_basis": "consolidated"}),
    ):
        result = evaluate(
            request(
                method="sotp",
                holdings=(),
                components=(replace(component, net_debt=debt),),
                ownership=(edge(),),
            )
        )
        assert result.value is None
        assert any("standalone business net debt" in issue for issue in result.issues)


def test_accounting_and_debt_boundaries():
    result = evaluate(request(accounting_basis="consolidated"))
    assert result.value is None
    component = ValuationComponent(
        "business:sub",
        "sub",
        fact("enterprise_value", "1000", "sub", dimensions={"accounting_basis": "standalone"}),
        "enterprise",
        fact("net_debt", "200", "sub", dimensions={"accounting_basis": "standalone"}),
    )
    result = evaluate(
        request(method="sotp", holdings=(), components=(component,), ownership=(edge(),))
    )
    assert result.value == "400.0"
    repeated = replace(component, value_basis="equity")
    result = evaluate(
        request(method="sotp", holdings=(), components=(repeated,), ownership=(edge(),))
    )
    assert result.value is None
    assert any("already reflected" in issue for issue in result.issues)
    wrong_debt = replace(component, net_debt=fact("net_debt", "200", "other"))
    result = evaluate(
        request(method="sotp", holdings=(), components=(wrong_debt,), ownership=(edge(),))
    )
    assert result.value is None


def test_parent_debt_only_and_matching_accounting():
    debt = FinancialAdjustment(
        "parent:debt",
        fact("debt", "50", dimensions={"accounting_basis": "standalone"}),
        "parent_obligation",
    )
    result = evaluate(request(method="holding_nav", adjustments=(debt,)))
    assert result.value == "150"
    subsidiary_debt = replace(debt, value=replace(debt.value, entity_id="asset"))
    assert evaluate(request(method="holding_nav", adjustments=(subsidiary_debt,))).value is None
    mixed = replace(
        debt, value=replace(debt.value, dimensions={"accounting_basis": "consolidated"})
    )
    assert evaluate(request(method="holding_nav", adjustments=(mixed,))).value is None


def test_split_reconciles_quantity_and_nominal_price():
    value = holding()
    before = replace(value.shares, effective_at=OLD)
    after = replace(
        value.price, value="2", dimensions={**value.price.dimensions, "share_basis": "basis-v2"}
    )
    split = fact(
        "split_ratio",
        "10",
        "asset",
        "ratio",
        effective_at="2026-09-01T00:00:00Z",
        dimensions={
            "security_id": value.security_id,
            "from_basis": "basis-v1",
            "to_basis": "basis-v2",
        },
    )
    result = evaluate(
        request(holdings=(replace(value, shares=before, price=after, corporate_actions=(split,)),))
    )
    assert result.value == "200"
    assert evaluate(request(holdings=(replace(value, shares=before, price=after),))).value is None
    adjusted = replace(value.price, metric="adjusted_close")
    assert evaluate(request(holdings=(replace(value, price=adjusted),))).value is None


def test_historical_availability_and_stale_suppression():
    future = replace(
        holding().shares, available_at="2026-10-30T00:00:00Z", ingested_at="2026-10-30T01:00:00Z"
    )
    assert evaluate(request(holdings=(replace(holding(), shares=future),))).value is None
    stale_cap = replace(fact(), effective_at=OLD)
    result = evaluate(
        request(
            method="holding_nav",
            market_cap=stale_cap,
            completeness=complete(),
            expected_interest_ids=("listed:parent:security:asset",),
        )
    )
    assert result.freshness == "stale"
    assert result.discount_to_nav is None
    assert not result.ranking_eligible


def test_fx_is_explicit_and_reproducible():
    value = holding(price="0.33333333333333333333")
    foreign = replace(value.price, unit="USD")
    fx = fact("fx_rate", "83.5", unit="USD/INR")
    inputs = request(holdings=(replace(value, price=foreign, fx=fx),))
    with localcontext() as context:
        context.prec = 8
        a = evaluate(inputs)
    with localcontext() as context:
        context.prec = 60
        b = evaluate(inputs)
    assert a == b
    assert evaluate(request(holdings=(replace(value, price=foreign),))).value is None
    assert a.snapshot_id == evaluate(inputs).snapshot_id


@pytest.fixture
def store(tmp_path):
    with StockStore(tmp_path / "stock.sqlite") as value:
        yield value


def evidence(store, **kwargs):
    values = {
        "source_id": "issuer",
        "url": "https://issuer.example/annual-report.pdf",
        "body": b"Original retained filing bytes",
        "available_at": OLD,
        "ingested_at": NOW,
        "media_type": "application/pdf",
    }
    values.update(kwargs)
    return store.retain_evidence(**values)


def test_retained_evidence_and_extraction_are_immutable(store):
    receipt = evidence(store)
    assert store.evidence_bytes(receipt.id) == b"Original retained filing bytes"
    initial = fact(evidence_id=receipt.id)
    assert store.put_fact(initial) == initial.id
    retry = replace(initial, ingested_at="2026-10-30T00:00:00Z")
    assert store.put_fact(retry) == initial.id
    assert len(store.facts(as_of=NOW)) == 1
    correction = replace(
        initial,
        value="101",
        available_at="2026-10-30T00:00:00Z",
        ingested_at="2026-10-30T00:00:00Z",
    )
    store.put_fact(correction)
    assert store.latest_facts(as_of=NOW)[0].value == "100"
    assert store.latest_facts(as_of="2026-10-31T00:00:00Z")[0].value == "101"
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        store.connection.execute("UPDATE facts SET metric='changed'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        store.connection.execute("DELETE FROM evidence")


def test_as_of_and_ingestion_time_are_distinct(store):
    receipt = evidence(store)
    store.put_fact(fact(effective_at=OLD, available_at=OLD, evidence_id=receipt.id))
    assert store.facts(as_of="2026-04-30T00:00:00Z")
    assert not store.facts(as_of="2026-04-30T00:00:00Z", known_at="2026-04-30T00:00:00Z")
    assert not store.facts(as_of="2026-03-30T00:00:00Z")


def test_rights_unknown_and_prohibited_fail_closed(store):
    receipt = evidence(store)
    store.put_fact(fact(evidence_id=receipt.id))
    blocked = store.dataset(as_of=NOW)
    assert blocked["facts"] == []
    assert blocked["coverage"] == "unavailable"
    permitted = SourceRights(
        "issuer", "https://issuer.example/policy", internal_use="permitted", reviewed_at=NOW
    )
    store.put_rights(permitted)
    private = store.dataset(as_of=NOW)
    assert private["facts"][0]["value"] == "100"
    assert private["evidence"][0]["id"] == receipt.id
    assert store.dataset(as_of=NOW, audience="display")["facts"] == []
    assert store.dataset(as_of=NOW, audience="export")["facts"] == []
    denied = replace(permitted, internal_use="prohibited", reviewed_at="2026-10-30T00:00:00Z")
    store.put_rights(denied)
    assert store.dataset(as_of=NOW)["facts"] == []
    assert store.snapshot(private["snapshot_id"])["facts"] == private["facts"]


def test_missing_stale_and_snapshot_replay(store):
    receipt = evidence(store)
    store.put_rights(
        SourceRights(
            "issuer", "https://issuer.example/policy", internal_use="permitted", reviewed_at=NOW
        )
    )
    store.put_fact(fact(evidence_id=receipt.id, effective_at=OLD))
    data = store.dataset(as_of=NOW, required_metrics=("market_cap", "shares_outstanding"))
    assert data["coverage"] == "partial"
    assert data["freshness"] == "stale"
    assert data["missing_metrics"] == ["shares_outstanding"]
    assert (
        data["snapshot_id"]
        == store.dataset(as_of=NOW, required_metrics=("market_cap", "shares_outstanding"))[
            "snapshot_id"
        ]
    )


def test_nested_batch_rollback_is_atomic(store):
    with pytest.raises(RuntimeError):
        with store.transaction():
            receipt = evidence(store)
            store.put_fact(fact(evidence_id=receipt.id))
            raise RuntimeError("stop before commit")
    assert store.facts(as_of=NOW) == []
    assert store.evidence(receipt.id) is None
    with store.transaction():
        receipt = evidence(store)
        store.put_facts(
            [
                fact(evidence_id=receipt.id),
                fact("shares_outstanding", "10", unit="shares", evidence_id=receipt.id),
            ]
        )
    assert len(store.facts(as_of=NOW)) == 2


def test_fact_must_bind_retained_public_evidence(store):
    with pytest.raises(ValueError, match="retained"):
        store.put_fact(fact())
    receipt = evidence(store)
    with pytest.raises(ValueError, match="availability"):
        store.put_fact(fact(evidence_id=receipt.id, available_at="2026-03-30T00:00:00Z"))


def test_identity_versions_and_changes_keep_fact_inputs(store):
    first = store.put_entity(
        Entity("issuer-id", "Issuer Ltd", "IN", {"cin": "CIN"}, ("Old Issuer Ltd",))
    )
    second = store.put_entity(
        Entity(
            "issuer-id", "Issuer Limited", "IN", {"cin": "CIN"}, ("Issuer Ltd", "Old Issuer Ltd")
        )
    )
    assert first != second
    assert store.identities()[0]["id"] == "issuer-id"
    store.put_security(
        Security("isin:IN0000000000", "issuer-id", "ISSUER.NS", "INR", isin="IN0000000000")
    )
    assert store.identities("security")[0]["entity_id"] == "issuer-id"
    old = {"snapshot_id": "s1", "facts": [fact().to_dict()]}
    new = {"snapshot_id": "s2", "facts": [replace(fact(), value="90").to_dict()]}
    changes = detect_changes(old, new)
    assert changes[0]["before"]["value"] == "100"
    assert changes[0]["after"]["value"] == "90"
    assert changes[0]["previous_snapshot_id"] == "s1"
    assert changes[0]["classification"] == "numerical_observation"
    assert detect_changes(new, new) == []


def test_price_history_never_fetches_network_and_preserves_days(store):
    receipt = evidence(store)
    store.put_facts(
        [
            fact(
                "adjusted_close",
                "20",
                "issuer",
                effective_at="2026-10-26T20:00:00Z",
                evidence_id=receipt.id,
                dimensions={"ticker": "ISSUER.NS"},
            ),
            fact(
                "adjusted_close",
                "22",
                "issuer",
                effective_at="2026-10-27T20:00:00Z",
                evidence_id=receipt.id,
                dimensions={"ticker": "ISSUER.NS"},
            ),
        ]
    )
    prices = store.historical_closes("ISSUER.NS", "2026-10-26", "2026-10-28")
    assert prices == [
        {"date": 20261026, "close": 20.0, "volume": None},
        {"date": 20261027, "close": 22.0, "volume": None},
    ]
    assert store.historical_closes("MISSING.NS", "2026-10-26", "2026-10-28") == []


def test_public_availability_handles_whole_and_fractional_seconds_exactly(store):
    document = evidence(store, available_at=OLD, ingested_at=OLD)
    first = fact(
        "assets",
        "100",
        effective_at=OLD,
        available_at=DAY,
        ingested_at=NOW,
        evidence_id=document.id,
    )
    second = replace(first, value="110", available_at="2026-10-29T00:00:00.1Z")
    store.put_facts([first, second])
    assert [f.value for f in store.latest_facts(as_of=DAY)] == ["100"]
    assert [f.value for f in store.latest_facts(as_of="2026-10-29T00:00:00.2Z")] == ["110"]
