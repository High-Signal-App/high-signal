"""Seed integrity preflight — validates entity FK, relationship FK, signal_type
coverage, source field completeness. Exits non-zero on failure.

  uv run python -m high_signal_ingest.preflight
"""

from __future__ import annotations

import sys
from typing import Iterable

from .seed import load_entities, load_relationships, load_signal_types, load_sources
from .types import Entity


_VALID_RELATIONSHIP_TYPES = {
    "supplier",
    "customer",
    "peer",
    "subsidiary",
    "partner",
    "competitor",
}


def _check_entity_unique(entities: list[Entity]) -> list[str]:
    seen: dict[str, int] = {}
    errors: list[str] = []
    for e in entities:
        seen[e.id] = seen.get(e.id, 0) + 1
    for k, v in seen.items():
        if v > 1:
            errors.append(f"duplicate entity id: {k} (×{v})")
    return errors


def _check_relationships(entities: list[Entity], relationships: Iterable) -> list[str]:
    valid_ids = {e.id for e in entities}
    errors: list[str] = []
    for r in relationships:
        if r.from_entity_id not in valid_ids:
            errors.append(f"FK miss: relationship.from {r.from_entity_id} → {r.to_entity_id}")
        if r.to_entity_id not in valid_ids:
            errors.append(f"FK miss: relationship.to {r.from_entity_id} → {r.to_entity_id}")
        if r.type not in _VALID_RELATIONSHIP_TYPES:
            errors.append(f"bad type: {r.type} for {r.from_entity_id}→{r.to_entity_id}")
        if not (0 < r.weight <= 1.0):
            errors.append(
                f"weight out of range: {r.weight} for {r.from_entity_id}→{r.to_entity_id}"
            )
    return errors


def _check_signal_types(types: list[dict]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    required = {
        "id",
        "name",
        "primary_entity_types",
        "spillover_pattern",
        "default_window_days",
    }
    for t in types:
        tid = t.get("id")
        if not tid:
            errors.append(f"signal_type missing id: {t}")
            continue
        if tid in seen:
            errors.append(f"duplicate signal_type id: {tid}")
        seen.add(tid)
        for k in required:
            if k not in t:
                errors.append(f"signal_type {tid} missing field: {k}")
    return errors


def _check_sources(sources: list[dict]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    valid_strategies = {
        "trafilatura",
        "newspaper4k",
        "edgartools",
        "reddit_api",
        "x_api",
        "youtube_transcript",
        "rss_only",
        "jina_reader",
        "custom",
    }
    for s in sources:
        sid = s.get("id")
        if not sid:
            errors.append(f"source missing id: {s.get('name')}")
            continue
        if sid in seen:
            errors.append(f"duplicate source id: {sid}")
        seen.add(sid)
        for k in ("name", "type", "url", "tier", "extraction_strategy"):
            if k not in s:
                errors.append(f"source {sid} missing field: {k}")
        strat = s.get("extraction_strategy")
        if strat and strat not in valid_strategies:
            errors.append(f"source {sid} has unknown extraction_strategy: {strat}")
    return errors


def run() -> int:
    entities = load_entities()
    relationships = load_relationships()
    signal_types = load_signal_types()
    sources = load_sources()

    errors: list[str] = []
    errors += _check_entity_unique(entities)
    errors += _check_relationships(entities, relationships)
    errors += _check_signal_types(signal_types)
    errors += _check_sources(sources)

    print(f"entities: {len(entities)}")
    print(f"relationships: {len(relationships)}")
    print(f"signal_types: {len(signal_types)}")
    print(f"sources: {len(sources)}")

    if errors:
        print(f"\n❌ {len(errors)} error(s):")
        for e in errors[:50]:
            print(f"  · {e}")
        if len(errors) > 50:
            print(f"  · ... +{len(errors) - 50} more")
        return 1

    print("\n✓ seed integrity OK")
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
