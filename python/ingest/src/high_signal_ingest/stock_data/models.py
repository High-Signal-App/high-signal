"""Immutable, source-backed contracts. Numerical values cross the boundary as decimals."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal

CONTRACT_VERSION = "stock-data.v1"
Permission = Literal["permitted", "prohibited", "unknown"]


def canonical_json(value: object) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def content_id(prefix: str, value: object) -> str:
    return f"{prefix}:{hashlib.sha256(canonical_json(value).encode()).hexdigest()}"


def series_id(entity_id: str, metric: str, unit: str, dimensions: dict[str, str]) -> str:
    # Filing provenance and share-basis revisions do not create a second holding.
    identity = {
        key: value
        for key, value in dimensions.items()
        if key not in {"accession", "form", "share_basis", "price_basis"}
    }
    return content_id("series", [entity_id, metric, unit, identity])


def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("stock-data timestamps require an explicit timezone")
    return parsed.astimezone(timezone.utc)


def utc(value: str) -> str:
    return instant(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def decimal_value(value: str | int | Decimal) -> Decimal:
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError("invalid decimal value") from exc
    if not result.is_finite():
        raise ValueError("non-finite stock-data value")
    return result


@dataclass(frozen=True)
class Entity:
    id: str
    name: str
    country: str
    identifiers: dict[str, str] = field(default_factory=dict)
    aliases: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.id or not self.name or not self.country:
            raise ValueError("entity identity, legal name and country are required")


@dataclass(frozen=True)
class Security:
    id: str
    entity_id: str
    ticker: str
    currency: str
    share_class: str = "ordinary"
    isin: str | None = None

    def __post_init__(self) -> None:
        if not all((self.id, self.entity_id, self.ticker, self.currency, self.share_class)):
            raise ValueError(
                "security identity, issuer, listing, currency and share class required"
            )


@dataclass(frozen=True)
class SourceRights:
    id: str
    policy_url: str
    internal_use: Permission = "unknown"
    public_display: Permission = "unknown"
    export: Permission = "unknown"
    reviewed_at: str | None = None
    note: str = ""

    def __post_init__(self) -> None:
        if not self.id or not self.policy_url.startswith("https://"):
            raise ValueError("source rights need an identity and original HTTPS policy reference")
        permissions = (self.internal_use, self.public_display, self.export)
        if any(p not in {"permitted", "prohibited", "unknown"} for p in permissions):
            raise ValueError("unsupported source permission")
        if "permitted" in permissions and not self.reviewed_at:
            raise ValueError("permitted rights require a dated rights review")
        if self.reviewed_at:
            object.__setattr__(self, "reviewed_at", utc(self.reviewed_at))

    @property
    def version_id(self) -> str:
        return content_id("rights", asdict(self))

    def allows(self, audience: str) -> bool:
        attr = {"internal": "internal_use", "display": "public_display", "export": "export"}.get(
            audience
        )
        if not attr:
            raise ValueError("audience must be internal, display or export")
        return getattr(self, attr) == "permitted"


@dataclass(frozen=True)
class Evidence:
    id: str
    source_id: str
    url: str
    sha256: str
    available_at: str
    ingested_at: str
    media_type: str


@dataclass(frozen=True)
class Fact:
    entity_id: str
    metric: str
    value: str | None
    unit: str
    effective_at: str
    available_at: str
    ingested_at: str
    evidence_id: str
    locator: str
    dimensions: dict[str, str] = field(default_factory=dict)
    kind: Literal["observed", "derived", "estimate"] = "observed"
    extractor_version: str = "manual.v1"
    status: Literal["available", "unavailable"] = "available"

    def __post_init__(self) -> None:
        if not all(
            (
                self.entity_id,
                self.metric,
                self.unit,
                self.evidence_id,
                self.locator,
                self.extractor_version,
            )
        ):
            raise ValueError(
                "facts require identity, unit, retained evidence, locator and extraction version"
            )
        if self.kind not in {"observed", "derived", "estimate"}:
            raise ValueError("unsupported fact kind")
        if self.status not in {"available", "unavailable"}:
            raise ValueError("unsupported fact status")
        if (self.value is None) != (self.status == "unavailable"):
            raise ValueError("missing values must be explicitly unavailable; missing is not zero")
        if self.value is not None:
            object.__setattr__(self, "value", str(decimal_value(self.value)))
        if any(
            not isinstance(k, str) or not isinstance(v, str) for k, v in self.dimensions.items()
        ):
            raise ValueError("fact dimensions must be strings")
        for key in ("effective_at", "available_at", "ingested_at"):
            object.__setattr__(self, key, utc(getattr(self, key)))
        if instant(self.available_at) > instant(self.ingested_at):
            raise ValueError("a fact cannot be ingested before public availability")

    @property
    def id(self) -> str:
        value = asdict(self)
        # A retry is the same extraction, rather than a new economic fact.
        value.pop("ingested_at")
        return content_id("fact", value)

    def to_dict(self) -> dict:
        return {"id": self.id, **asdict(self)}
