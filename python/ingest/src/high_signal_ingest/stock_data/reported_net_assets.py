"""Reported balance-sheet residual, deliberately separate from investment NAV."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, localcontext

from .models import content_id, decimal_value, instant

MODEL_VERSION = "reported-net-assets.v1"
LABEL = "Market cap / reported net assets"


@dataclass(frozen=True)
class ReportedNumber:
    value: Decimal
    tolerance: Decimal
    concept: str
    context: str


@dataclass(frozen=True)
class Statement:
    symbol: str
    isin: str
    basis: str
    period_end: str
    available_at: str
    evidence_id: str
    assets: ReportedNumber
    liabilities: ReportedNumber
    equity: ReportedNumber
    capital: ReportedNumber | None = None
    face_value: ReportedNumber | None = None
    parent_equity: ReportedNumber | None = None
    noncontrolling_interests: ReportedNumber | None = None

    @property
    def net_assets(self) -> Decimal:
        return self.assets.value - self.liabilities.value

    def validate(self) -> None:
        numbers = (self.assets, self.liabilities, self.equity)
        if len({number.context for number in numbers}) != 1:
            raise ValueError("mismatched_balance_sheet_context")
        if abs(self.net_assets - self.equity.value) > sum(n.tolerance for n in numbers):
            raise ValueError("balance_sheet_does_not_reconcile")
        if self.assets.value < 0 or self.liabilities.value < 0:
            raise ValueError("negative_assets_or_liabilities")


@dataclass(frozen=True)
class MarketObservation:
    symbol: str
    isin: str
    issued_shares: str | None
    raw_close: str | None
    price_date: str
    as_of: str
    input_ids: list[str]
    multiple_classes: bool = False
    price_stale: bool = False


def verified_share_quantity(
    statement: Statement, market: MarketObservation
) -> tuple[Decimal | None, str | None]:
    if market.multiple_classes:
        return None, "multiple_equity_share_classes"
    if not statement.capital or not statement.face_value:
        return None, "statement_share_count_unavailable"
    if market.issued_shares is None:
        return None, "master_issued_share_quantity_unavailable"
    shares = decimal_value(market.issued_shares)
    capital, face = statement.capital, statement.face_value
    if shares <= 0 or shares != shares.to_integral_value() or face.value <= 0 or capital.value <= 0:
        return None, "invalid_share_quantity_or_face_value"
    if abs(shares * face.value - capital.value) > capital.tolerance + shares * face.tolerance:
        return None, "master_and_filing_share_count_mismatch"
    return shares, None


def calculate(statement: Statement, *, market: MarketObservation) -> dict:
    """Calculate only after the master share quantity is verified against the filing."""
    statement.validate()
    if (statement.symbol, statement.isin) != (market.symbol, market.isin):
        raise ValueError("filing_identity_mismatch")
    now = instant(market.as_of)
    if (
        instant(statement.available_at) > now
        or date.fromisoformat(statement.period_end) > now.date()
    ):
        raise ValueError("statement_not_yet_available")
    if date.fromisoformat(market.price_date) > now.date():
        raise ValueError("price_not_yet_available")
    result = {
        "modelVersion": MODEL_VERSION,
        "label": LABEL,
        "asOf": market.as_of,
        "statementDate": statement.period_end,
        "statementBasis": statement.basis,
        "availableAt": statement.available_at,
        "priceDate": market.price_date,
        "assets": str(statement.assets.value),
        "externalLiabilities": str(statement.liabilities.value),
        "reportedEquity": str(statement.equity.value),
        "reportedNetAssets": str(statement.net_assets),
        "parentEquity": str(statement.parent_equity.value) if statement.parent_equity else None,
        "noncontrollingInterests": str(statement.noncontrolling_interests.value)
        if statement.noncontrolling_interests
        else None,
        "marketCap": None,
        "ratio": None,
        "verifiedShares": None,
        "rankingEligible": False,
        "reason": None,
        "inputIds": sorted(set([statement.evidence_id, *market.input_ids])),
        "warnings": [
            "Consolidated equity can include noncontrolling interests; this is not parent-common P/B."
        ]
        if statement.basis == "consolidated"
        else [],
    }
    shares, reason = verified_share_quantity(statement, market)
    if shares is not None:
        result["verifiedShares"] = str(shares)
        if market.raw_close is None:
            reason = "raw_close_unavailable"
        elif decimal_value(market.raw_close) <= 0:
            reason = "nonpositive_raw_close"
        else:
            with localcontext() as ctx:
                ctx.prec = 40
                cap = shares * decimal_value(market.raw_close)
                result["marketCap"] = str(cap)
                if statement.net_assets <= 0:
                    reason = "nonpositive_reported_net_assets"
                else:
                    result["ratio"] = str(cap / statement.net_assets)
    stale_statement = (now.date() - date.fromisoformat(statement.period_end)).days > 550
    if stale_statement:
        result["warnings"].append("Balance sheet is older than 550 days.")
    if market.price_stale:
        result["warnings"].append("Price session is stale; historical ratio only.")
    result["reason"] = reason
    result["rankingEligible"] = (
        result["ratio"] is not None and not stale_statement and not market.price_stale
    )
    result["resultId"] = content_id("reported-net-assets", result)
    return result
