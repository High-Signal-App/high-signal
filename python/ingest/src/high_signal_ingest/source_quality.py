"""Read-only source yield audit.

Fetches selected sources and reports whether they are producing mapped,
collection-relevant candidates or mostly noise. It does not write events,
draft signals, or touch D1.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Iterable

from . import pipeline
from .types import Event


DEFAULT_SOURCES = [
    "reddit",
    "youtube",
    "bluesky",
    "cisa-kev",
    "lobsters",
    "techmeme",
    "substack",
    "packages",
    "jobs",
    "github-archive",
    "huggingface",
    "nvd",
    "guardian",
    "patents",
    "gov-contracts",
    "wikidata",
    "semantic-scholar",
    "regulations",
    "companies-house",
    "metaculus",
    "podcast-index",
    "macro-rates",
    "sec-xbrl",
    "legistar",
    "courtlistener",
    "openstates",
    "hackernews",
    "stackexchange",
    "producthunt",
    "coingecko",
    "google-trends",
    "appstore",
    "defillama",
    "bls",
    "appstore-reviews",
    "playstore-reviews",
]
AUDITABLE_SOURCES = [
    "edgar",
    "news",
    "reddit",
    "ir",
    "github",
    "github-archive",
    "youtube",
    "bluesky",
    "gov",
    "gdelt",
    "hkex",
    "cisa-kev",
    "lobsters",
    "techmeme",
    "substack",
    "packages",
    "jobs",
    "huggingface",
    "nvd",
    "guardian",
    "patents",
    "gov-contracts",
    "wikidata",
    "semantic-scholar",
    "regulations",
    "companies-house",
    "metaculus",
    "podcast-index",
    "macro-rates",
    "sec-xbrl",
    "legistar",
    "courtlistener",
    "openstates",
    "hackernews",
    "stackexchange",
    "producthunt",
    "coingecko",
    "google-trends",
    "appstore",
    "defillama",
    "bls",
    "appstore-reviews",
    "playstore-reviews",
]


@dataclass(frozen=True)
class SourceYield:
    source: str
    events: int
    mapped_events: int
    unmapped_events: int
    mapping_rate: float
    source_families: dict[str, int]
    mapped_entities: dict[str, int]
    unmapped_samples: list[str]


def _sample_title(event: Event) -> str:
    title = event.title or event.source_url
    return title[:180]


def summarize(source: str, events: Iterable[Event]) -> SourceYield:
    event_list = list(events)
    mapped_entities: Counter[str] = Counter()
    unmapped_samples: list[str] = []
    families: Counter[str] = Counter()

    for event in event_list:
        families[event.source.split(":", 1)[0]] += 1
        entity_id = pipeline._event_entity(event)
        if entity_id:
            mapped_entities[entity_id] += 1
        elif len(unmapped_samples) < 10:
            unmapped_samples.append(_sample_title(event))

    mapped = sum(mapped_entities.values())
    total = len(event_list)
    return SourceYield(
        source=source,
        events=total,
        mapped_events=mapped,
        unmapped_events=total - mapped,
        mapping_rate=round(mapped / total, 4) if total else 0.0,
        source_families=dict(families.most_common()),
        mapped_entities=dict(mapped_entities.most_common(12)),
        unmapped_samples=unmapped_samples,
    )


def run(sources: list[str], days: int) -> list[SourceYield]:
    rows: list[SourceYield] = []
    for source in sources:
        events = pipeline.fetch(source, days)
        rows.append(summarize(source, events))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        action="append",
        choices=AUDITABLE_SOURCES,
        help="Source to audit; repeatable. Excludes markets/all because this command is read-only.",
    )
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    argv = [arg for arg in sys.argv[1:] if arg != "--"]
    args = parser.parse_args(argv)

    sources = args.source or DEFAULT_SOURCES
    rows = run(sources, args.days)
    if args.json:
        print(json.dumps([asdict(row) for row in rows], indent=2))
        return

    for row in rows:
        print(
            f"{row.source}: events={row.events} mapped={row.mapped_events} "
            f"unmapped={row.unmapped_events} mapping_rate={row.mapping_rate:.0%}"
        )
        if row.mapped_entities:
            print(f"  mapped_entities={row.mapped_entities}")
        if row.unmapped_samples:
            print("  unmapped_samples:")
            for sample in row.unmapped_samples[:5]:
                print(f"    - {sample}")


if __name__ == "__main__":
    main()
