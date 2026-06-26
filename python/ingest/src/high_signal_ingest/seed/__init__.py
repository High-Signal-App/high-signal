"""Seed data loaders — entities, relationships, signal types, sources."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable

import yaml

from ..types import Entity, Relationship


_SEED_DIR = Path(__file__).resolve().parent


def load_entities() -> list[Entity]:
    path = _SEED_DIR / "ai_infra_entities.csv"
    out: list[Entity] = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            aliases = row.get("aliases") or ""
            out.append(
                Entity(
                    id=row["id"],
                    ticker=row.get("ticker") or None,
                    name=row["name"],
                    type=row["type"],  # type: ignore[arg-type]
                    country=row.get("country") or None,
                    sector=row.get("sector") or None,
                    subsector=row.get("subsector") or None,
                    aliases=[a for a in aliases.split("|") if a],
                    wiki_url=row.get("wiki_url") or None,
                    ir_url=row.get("ir_url") or None,
                )
            )
    return out


def load_relationships() -> list[Relationship]:
    path = _SEED_DIR / "relationships.csv"
    if not path.exists():
        return []
    out: list[Relationship] = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            out.append(
                Relationship(
                    from_entity_id=row["from_entity_id"],
                    to_entity_id=row["to_entity_id"],
                    type=row["type"],  # type: ignore[arg-type]
                    weight=float(row.get("weight") or 1.0),
                    evidence_url=row.get("evidence_url") or None,
                    note=row.get("note") or None,
                )
            )
    return out


def load_signal_types() -> list[dict]:
    path = _SEED_DIR / "signal_types.yaml"
    if not path.exists():
        return []
    with path.open() as f:
        data = yaml.safe_load(f) or []
    return list(data)


def signal_type_ids() -> list[str]:
    """Return the configured signal taxonomy ids in prompt-stable order."""
    return [str(t["id"]) for t in load_signal_types() if t.get("id")]


def load_sources() -> list[dict]:
    path = _SEED_DIR / "sources.yaml"
    if not path.exists():
        return []
    with path.open() as f:
        data = yaml.safe_load(f) or []
    return list(data)


def entity_gazetteer(entities: Iterable[Entity]) -> dict[str, str]:
    """Build a name/alias/ticker → entity_id lookup table.

    ``THEME_*`` ids are synthetic thematic buckets (e.g. data-center buildout)
    used only to attach entity-less thematic signals to a valid entity row; they
    are never *detected* from text, so they are excluded from the gazetteer.
    """
    lut: dict[str, str] = {}
    for e in entities:
        if e.id.startswith("THEME_"):
            continue
        lut[e.name.lower()] = e.id
        if e.ticker:
            lut[e.ticker.lower()] = e.id
        for a in e.aliases:
            lut[a.lower()] = e.id
    return lut
