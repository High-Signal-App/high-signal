"""Conservative valuation engine: facts in, reproducible numerical observations out."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import timedelta
from decimal import Decimal, localcontext
from typing import Literal

from .models import Fact, content_id, decimal_value, instant, utc, series_id

MODEL_VERSION = "stock-valuation.v1"


@dataclass(frozen=True)
class OwnershipEdge:
    owner_entity_id: str
    asset_entity_id: str
    fraction: Fact


@dataclass(frozen=True)
class ListedHolding:
    owner_entity_id: str
    asset_entity_id: str
    security_id: str
    shares: Fact
    price: Fact
    fx: Fact | None = None
    corporate_actions: tuple[Fact, ...] = ()


@dataclass(frozen=True)
class ValuationComponent:
    interest_id: str
    asset_entity_id: str
    value: Fact
    value_basis: Literal["equity", "enterprise"] = "equity"
    net_debt: Fact | None = None
    fx: Fact | None = None


@dataclass(frozen=True)
class FinancialAdjustment:
    interest_id: str
    value: Fact
    role: Literal["other_net_assets", "parent_obligation", "tax", "minority_interest"]


@dataclass(frozen=True)
class ValuationRequest:
    parent_entity_id: str
    currency: str
    as_of: str
    input_snapshot_ids: tuple[str, ...]
    market_cap: Fact | None
    method: Literal["listed_coverage", "holding_nav", "sotp"] = "listed_coverage"
    accounting_basis: Literal["standalone", "consolidated"] = "standalone"
    holdings: tuple[ListedHolding, ...] = ()
    ownership: tuple[OwnershipEdge, ...] = ()
    components: tuple[ValuationComponent, ...] = ()
    adjustments: tuple[FinancialAdjustment, ...] = ()
    completeness: Fact | None = None
    expected_interest_ids: tuple[str, ...] = ()
    max_price_age_days: int = 7
    max_filing_age_days: int = 550


@dataclass(frozen=True)
class ValuationResult:
    snapshot_id: str
    model_version: str
    parent_entity_id: str
    method: str
    currency: str
    as_of: str
    input_snapshot_ids: tuple[str, ...]
    input_fact_ids: tuple[str, ...]
    coverage: str
    freshness: str
    value: str | None
    market_cap: str | None
    listed_investment_coverage: str | None
    discount_to_nav: str | None
    ranking_eligible: bool
    components: tuple[dict, ...]
    issues: tuple[str, ...]

    def to_dict(self) -> dict:
        return asdict(self)


class UnsupportedValuation(ValueError):
    pass


def _fraction(edge: OwnershipEdge, as_of: str) -> Decimal:
    _available(edge.fraction, as_of)
    if (
        edge.fraction.entity_id != edge.owner_entity_id
        or edge.fraction.metric != "ownership_fraction"
    ):
        raise UnsupportedValuation("ownership edge lacks its owner's fraction fact")
    if edge.fraction.dimensions.get("asset_entity_id") != edge.asset_entity_id:
        raise UnsupportedValuation("ownership edge target does not match retained fraction")
    value = decimal_value(edge.fraction.value)
    if edge.fraction.unit != "fraction" or not 0 <= value <= 1:
        raise UnsupportedValuation("invalid ownership fraction")
    return value


def _available(fact: Fact | None, as_of: str) -> None:
    if fact is None or fact.value is None:
        raise UnsupportedValuation("required fact unavailable")
    if instant(fact.available_at) > instant(as_of) or instant(fact.effective_at) > instant(as_of):
        raise UnsupportedValuation("input not publicly available and effective at valuation time")


def ownership_exposure(
    parent_entity_id: str, edges: tuple[OwnershipEdge, ...], as_of: str
) -> dict[str, Decimal]:
    """Sum economic exposure along acyclic paths; never invert a circular ownership matrix."""
    graph: dict[str, list[tuple[str, Decimal]]] = {}
    identities: set[tuple[str, str]] = set()
    for edge in edges:
        identity = (edge.owner_entity_id, edge.asset_entity_id)
        if identity in identities:
            raise UnsupportedValuation("duplicate direct ownership interest")
        identities.add(identity)
        graph.setdefault(edge.owner_entity_id, []).append(
            (edge.asset_entity_id, _fraction(edge, as_of))
        )
    result: dict[str, Decimal] = {parent_entity_id: Decimal(1)}

    def visit(node: str, multiplier: Decimal, path: frozenset[str]) -> None:
        if node in path:
            raise UnsupportedValuation("ownership cycle; calculation withheld")
        for asset, fraction in sorted(graph.get(node, [])):
            exposure = multiplier * fraction
            result[asset] = result.get(asset, Decimal(0)) + exposure
            if result[asset] > 1:
                raise UnsupportedValuation("economic exposure exceeds 100%; ambiguous ownership")
            visit(asset, exposure, path | {node})

    with localcontext() as context:
        context.prec = 40
        visit(parent_entity_id, Decimal(1), frozenset())
    return result


def _ancestors_overlap(assets: list[str], edges: tuple[OwnershipEdge, ...]) -> bool:
    graph: dict[str, set[str]] = {}
    for edge in edges:
        graph.setdefault(edge.owner_entity_id, set()).add(edge.asset_entity_id)
    selected = set(assets)
    for asset in assets:
        pending = list(graph.get(asset, set()))
        seen: set[str] = set()
        while pending:
            node = pending.pop()
            if node in selected:
                return True
            if node not in seen:
                seen.add(node)
                pending.extend(graph.get(node, set()))
    return False


def _fx(value: Fact, currency: str, fx: Fact | None, as_of: str) -> Decimal:
    if value.unit == currency:
        if fx is not None:
            raise UnsupportedValuation("same-currency value must not apply FX")
        return Decimal(1)
    _available(fx, as_of)
    assert fx is not None
    if fx.metric != "fx_rate" or fx.unit != f"{value.unit}/{currency}":
        raise UnsupportedValuation("FX pair must explicitly convert source into valuation currency")
    rate = decimal_value(fx.value)
    if rate <= 0:
        raise UnsupportedValuation("nonpositive FX rate")
    return rate


def listed_holding_value(holding: ListedHolding, currency: str, as_of: str) -> Decimal:
    _available(holding.shares, as_of)
    _available(holding.price, as_of)
    shares, price = holding.shares, holding.price
    if shares.kind != "observed" or price.kind != "observed":
        raise UnsupportedValuation(
            "listed holdings require disclosed quantities and observed market prices"
        )
    if shares.metric != "shares_owned" or shares.unit != "shares":
        raise UnsupportedValuation("holding requires disclosed shares_owned")
    if (
        shares.entity_id != holding.owner_entity_id
        or shares.dimensions.get("security_id") != holding.security_id
    ):
        raise UnsupportedValuation("holding owner/security mismatch")
    if (
        price.entity_id != holding.asset_entity_id
        or price.dimensions.get("security_id") != holding.security_id
    ):
        raise UnsupportedValuation("price issuer/security mismatch")
    if price.metric != "raw_close" or price.dimensions.get("price_basis") != "nominal":
        raise UnsupportedValuation(
            "valuation requires a nominal price, never adjusted return history"
        )
    if instant(shares.effective_at) > instant(price.effective_at):
        raise UnsupportedValuation("holding quantity is from after its valuation price")
    quantity = decimal_value(shares.value)
    if quantity < 0 or decimal_value(price.value) <= 0:
        raise UnsupportedValuation("negative holding quantity or nonpositive price")
    share_basis = shares.dimensions.get("share_basis")
    price_basis = price.dimensions.get("share_basis")
    if not share_basis or not price_basis:
        raise UnsupportedValuation("unverified corporate-action share basis")
    actions = sorted(holding.corporate_actions, key=lambda f: (f.effective_at, f.id))
    seen: set[str] = set()
    for action in actions:
        _available(action, as_of)
        if action.id in seen:
            raise UnsupportedValuation("duplicate corporate action")
        seen.add(action.id)
        if (
            action.metric != "split_ratio"
            or action.dimensions.get("security_id") != holding.security_id
        ):
            raise UnsupportedValuation("unsupported corporate action")
        if (
            not instant(shares.effective_at)
            < instant(action.effective_at)
            <= instant(price.effective_at)
        ):
            raise UnsupportedValuation("corporate action outside holding-to-price window")
        if action.dimensions.get("from_basis") != share_basis:
            raise UnsupportedValuation("corporate action chain does not reconcile quantity basis")
        quantity *= decimal_value(action.value)
        if quantity < 0 or decimal_value(action.value) <= 0:
            raise UnsupportedValuation("invalid split or bonus ratio")
        share_basis = action.dimensions.get("to_basis")
    if share_basis != price_basis:
        raise UnsupportedValuation("corporate actions do not reconcile holding shares with price")
    return quantity * decimal_value(price.value) * _fx(price, currency, holding.fx, as_of)


def _inputs(request: ValuationRequest) -> list[Fact]:
    facts: list[Fact] = []
    for value in (request.market_cap, request.completeness):
        if value:
            facts.append(value)
    facts.extend(edge.fraction for edge in request.ownership)
    for holding in request.holdings:
        facts.extend((holding.shares, holding.price, *holding.corporate_actions))
        if holding.fx:
            facts.append(holding.fx)
    for component in request.components:
        facts.append(component.value)
        facts.extend(v for v in (component.net_debt, component.fx) if v)
    facts.extend(item.value for item in request.adjustments)
    return facts


def evaluate(request: ValuationRequest) -> ValuationResult:
    """Withhold unsupported numerical results; incomplete NAV never receives a discount rank."""
    if request.method not in {"listed_coverage", "holding_nav", "sotp"}:
        raise ValueError("unknown valuation method")
    if request.accounting_basis not in {"standalone", "consolidated"}:
        raise ValueError("unknown accounting basis")
    if request.max_price_age_days < 0 or request.max_filing_age_days < 0:
        raise ValueError("freshness limits must be nonnegative")
    as_of = utc(request.as_of)
    facts = _inputs(request)
    fact_ids = tuple(sorted({f.id for f in facts}))
    issues: list[str] = []
    lines: list[dict] = []
    stale = False
    total: Decimal | None = None
    market_cap: Decimal | None = None
    coverage_ratio: Decimal | None = None
    discount: Decimal | None = None
    complete = False
    try:
        if not request.input_snapshot_ids or any(not value for value in request.input_snapshot_ids):
            raise UnsupportedValuation("versioned input snapshot IDs are required")
        _available(request.market_cap, as_of)
        assert request.market_cap is not None
        if (
            request.market_cap.entity_id != request.parent_entity_id
            or request.market_cap.metric != "market_cap"
        ):
            raise UnsupportedValuation("parent market-cap fact mismatch")
        if request.market_cap.unit != request.currency:
            raise UnsupportedValuation("parent market cap is not in valuation currency")
        market_cap = decimal_value(request.market_cap.value)
        if market_cap <= 0:
            raise UnsupportedValuation("parent market cap must be positive")
        for fact in facts:
            _available(fact, as_of)
            budget = (
                request.max_price_age_days
                if fact.metric in {"raw_close", "market_cap", "fx_rate"}
                else request.max_filing_age_days
            )
            if instant(fact.effective_at) < instant(as_of) - timedelta(days=budget):
                stale = True
        exposure = ownership_exposure(request.parent_entity_id, request.ownership, as_of)
        interest_ids = [f"listed:{h.owner_entity_id}:{h.security_id}" for h in request.holdings]
        interest_ids.extend(c.interest_id for c in request.components)
        interest_ids.extend(a.interest_id for a in request.adjustments)
        if len(interest_ids) != len(set(interest_ids)):
            raise UnsupportedValuation("duplicate economic interest")
        adjustment_ids = [a.value.id for a in request.adjustments]
        if len(adjustment_ids) != len(set(adjustment_ids)):
            raise UnsupportedValuation("one financial fact cannot be adjusted twice")
        adjustment_metrics = {item.value.metric for item in request.adjustments}
        if "net_debt" in adjustment_metrics and adjustment_metrics & {
            "cash",
            "cash_equivalents",
            "debt",
            "borrowings",
            "lease_liabilities",
        }:
            raise UnsupportedValuation("net debt overlaps cash or gross-debt adjustments")
        if request.method == "listed_coverage" and (request.components or request.adjustments):
            raise UnsupportedValuation("listed coverage cannot include other assets or adjustments")
        if request.accounting_basis != "standalone" and (request.holdings or request.components):
            raise UnsupportedValuation(
                "investment look-through requires standalone parent accounting"
            )
        selected_assets = [h.asset_entity_id for h in request.holdings]
        selected_assets.extend(c.asset_entity_id for c in request.components)
        if len(selected_assets) != len(set(selected_assets)):
            raise UnsupportedValuation(
                "asset selected more than once; consolidate share classes explicitly"
            )
        if request.parent_entity_id in selected_assets or _ancestors_overlap(
            selected_assets, request.ownership
        ):
            raise UnsupportedValuation(
                "intermediate holding and underlying economic assets overlap"
            )
        with localcontext() as context:
            context.prec = 40
            total = Decimal(0)
            for holding in sorted(
                request.holdings, key=lambda h: (h.owner_entity_id, h.security_id)
            ):
                owner_exposure = exposure.get(holding.owner_entity_id)
                if owner_exposure is None:
                    raise UnsupportedValuation("holding owner has no supported path from parent")
                amount = listed_holding_value(holding, request.currency, as_of) * owner_exposure
                total += amount
                lines.append(
                    {
                        "interest_id": f"listed:{holding.owner_entity_id}:{holding.security_id}",
                        "asset_entity_id": holding.asset_entity_id,
                        "amount": str(amount),
                        "kind": "derived",
                        "input_fact_ids": sorted(
                            f.id
                            for f in (
                                holding.shares,
                                holding.price,
                                *holding.corporate_actions,
                                *((holding.fx,) if holding.fx else ()),
                            )
                        ),
                    }
                )
            for component in sorted(request.components, key=lambda c: c.interest_id):
                multiplier = exposure.get(component.asset_entity_id)
                if multiplier is None:
                    raise UnsupportedValuation("valued business has no supported ownership path")
                if component.value.entity_id != component.asset_entity_id:
                    raise UnsupportedValuation("component valuation belongs to a different entity")
                if component.value.dimensions.get("accounting_basis") != "standalone":
                    raise UnsupportedValuation(
                        "component accounting basis must be explicitly standalone"
                    )
                amount = decimal_value(component.value.value)
                if component.value_basis == "enterprise":
                    if component.value.metric != "enterprise_value":
                        raise UnsupportedValuation(
                            "enterprise component requires an enterprise-value fact"
                        )
                    if (
                        component.net_debt is None
                        or component.net_debt.unit != component.value.unit
                    ):
                        raise UnsupportedValuation(
                            "enterprise value needs matching business net debt"
                        )
                    if component.net_debt.entity_id != component.asset_entity_id:
                        raise UnsupportedValuation("business debt belongs to a different entity")
                    amount -= decimal_value(component.net_debt.value)
                elif component.value_basis == "equity":
                    if component.net_debt is not None:
                        raise UnsupportedValuation("debt is already reflected in equity value")
                    if component.value.metric not in {"equity_value", "fair_value"}:
                        raise UnsupportedValuation(
                            "equity component requires a supported equity-value fact"
                        )
                else:
                    raise UnsupportedValuation("unsupported component value basis")
                amount *= multiplier * _fx(component.value, request.currency, component.fx, as_of)
                total += amount
                lines.append(
                    {
                        "interest_id": component.interest_id,
                        "asset_entity_id": component.asset_entity_id,
                        "amount": str(amount),
                        "kind": component.value.kind,
                        "input_fact_ids": sorted(
                            f.id
                            for f in (
                                component.value,
                                *((component.net_debt,) if component.net_debt else ()),
                                *((component.fx,) if component.fx else ()),
                            )
                        ),
                    }
                )
            for adjustment in sorted(request.adjustments, key=lambda a: a.interest_id):
                fact = adjustment.value
                metrics = {
                    "other_net_assets": {
                        "cash",
                        "cash_equivalents",
                        "other_net_assets",
                        "net_assets",
                    },
                    "parent_obligation": {
                        "debt",
                        "net_debt",
                        "borrowings",
                        "lease_liabilities",
                        "parent_obligation",
                        "guarantee_obligation",
                    },
                    "tax": {"tax", "tax_liability", "tax_adjustment"},
                    "minority_interest": {"minority_interest"},
                }
                if fact.metric not in metrics.get(adjustment.role, set()):
                    raise UnsupportedValuation(
                        "financial adjustment metric does not support its valuation role"
                    )
                if fact.entity_id != request.parent_entity_id or fact.unit != request.currency:
                    raise UnsupportedValuation(
                        "only same-currency parent-level adjustments are supported"
                    )
                if fact.dimensions.get("accounting_basis") != request.accounting_basis:
                    raise UnsupportedValuation("mixed standalone and consolidated adjustments")
                amount = decimal_value(fact.value)
                if adjustment.role in {"parent_obligation", "tax", "minority_interest"}:
                    if amount < 0:
                        raise UnsupportedValuation(
                            "obligation must be a nonnegative disclosed amount"
                        )
                    amount = -amount
                elif adjustment.role != "other_net_assets":
                    raise UnsupportedValuation("unknown financial adjustment")
                total += amount
                lines.append(
                    {
                        "interest_id": adjustment.interest_id,
                        "asset_entity_id": request.parent_entity_id,
                        "amount": str(amount),
                        "kind": fact.kind,
                        "input_fact_ids": [fact.id],
                    }
                )
            if not lines:
                raise UnsupportedValuation("no supported valuation components")
            if request.expected_interest_ids and set(request.expected_interest_ids) != set(
                interest_ids
            ):
                issues.append("valuation scope is incomplete or includes undeclared interests")
            declaration = request.completeness
            complete = bool(
                declaration
                and declaration.entity_id == request.parent_entity_id
                and declaration.metric == "valuation_scope_complete"
                and decimal_value(declaration.value) == 1
                and declaration.kind == "observed"
                and declaration.unit == "boolean"
                and declaration.dimensions.get("method") == request.method
                and declaration.dimensions.get("accounting_basis") == request.accounting_basis
                and request.expected_interest_ids
                and set(request.expected_interest_ids) == set(interest_ids)
            )
            if request.method == "listed_coverage":
                coverage_ratio = total / market_cap
            elif complete and not stale and total > 0:
                discount = Decimal(1) - market_cap / total
            if request.method != "listed_coverage" and not complete:
                issues.append("incomplete NAV/SOTP; discount and definitive rankings withheld")
            if stale:
                issues.append("stale valuation input")
    except (UnsupportedValuation, ValueError) as exc:
        issues.append(str(exc))
        total, coverage_ratio, discount = None, None, None
        complete = False
        lines = []
    payload = {
        "model_version": MODEL_VERSION,
        "parent_entity_id": request.parent_entity_id,
        "method": request.method,
        "currency": request.currency,
        "as_of": as_of,
        "input_snapshot_ids": tuple(sorted(set(request.input_snapshot_ids))),
        "input_fact_ids": fact_ids,
        "coverage": "unavailable" if total is None else "complete" if complete else "partial",
        "freshness": "unavailable" if total is None else "stale" if stale else "fresh",
        "value": str(total) if total is not None else None,
        "market_cap": str(market_cap) if market_cap is not None else None,
        "listed_investment_coverage": str(coverage_ratio) if coverage_ratio is not None else None,
        "discount_to_nav": str(discount) if discount is not None else None,
        "ranking_eligible": bool(complete and not stale and discount is not None),
        "components": tuple(lines),
        "issues": tuple(sorted(set(issues))),
    }
    # Include the requested model scope even when it cannot produce a number.
    identity = {
        "result": payload,
        "request": {
            "accounting_basis": request.accounting_basis,
            "expected_interest_ids": sorted(request.expected_interest_ids),
            "max_price_age_days": request.max_price_age_days,
            "max_filing_age_days": request.max_filing_age_days,
        },
    }
    return ValuationResult(snapshot_id=content_id("valuation", identity), **payload)


def detect_changes(previous: dict | None, current: dict) -> list[dict]:
    """Changes carry changed facts and both snapshot identities, never an investment recommendation."""
    before = {canonical_fact_key(f): f for f in (previous or {}).get("facts", [])}
    after = {canonical_fact_key(f): f for f in current.get("facts", [])}
    changes: list[dict] = []
    for key in sorted(before.keys() | after.keys()):
        old, new = before.get(key), after.get(key)
        if old == new:
            continue
        changes.append(
            {
                "id": content_id(
                    "change", [(previous or {}).get("snapshot_id"), current["snapshot_id"], key]
                ),
                "previous_snapshot_id": (previous or {}).get("snapshot_id"),
                "snapshot_id": current["snapshot_id"],
                "entity_id": (new or old)["entity_id"],
                "metric": (new or old)["metric"],
                "before": old,
                "after": new,
                "classification": "numerical_observation",
                "research_candidate": True,
            }
        )
    return changes


def canonical_fact_key(fact: dict) -> str:
    return series_id(fact["entity_id"], fact["metric"], fact["unit"], fact.get("dimensions", {}))
