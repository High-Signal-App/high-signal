"""Relation extraction — GLiREL is parked.

GLiREL is not a declared dependency and is not invoked. Live spillover edges
come from hand-curated `relationships.csv` plus the manual review queue
(see ADR-004). This module returns a typed empty result so callers cannot
mistake the stub for a real extraction pass.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

LOGGER = logging.getLogger(__name__)

_PARKED_LOGGED = False

RelationBackend = Literal["none"]
RelationReason = Literal["glirel_parked"]


@dataclass(frozen=True)
class ExtractedRelation:
    """Shape reserved for a future GLiREL pass. Unused while parked."""

    source: str
    target: str
    type: str
    score: float
    evidence: str


@dataclass(frozen=True)
class RelationExtractionResult:
    relations: list[ExtractedRelation] = field(default_factory=list)
    available: bool = False
    reason: RelationReason = "glirel_parked"
    backend: RelationBackend = "none"


def _log_parked_once() -> None:
    global _PARKED_LOGGED
    if _PARKED_LOGGED:
        return
    LOGGER.info("GLiREL relation extraction is parked; returning an empty result")
    _PARKED_LOGGED = True


def extract_relations(text: str, entities: Iterable[str]) -> RelationExtractionResult:
    """Return a typed empty result. GLiREL is not run.

    Inputs are accepted so the call site can stay stable when extraction is
    later unparked; they are unused on purpose.
    """
    _ = (text, entities)
    _log_parked_once()
    return RelationExtractionResult()
