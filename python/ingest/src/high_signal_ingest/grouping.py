"""Deterministic grouping of ingested events — no RAG / no vectors.

The signal generator (`pipeline.cluster_and_generate`) groups events strictly by
mapped entity and drops everything entity-less, which loses most municipal /
policy / litigation / community data. This module groups *all* events along
several deterministic axes so nothing is dropped and cross-source corroboration
(the cite-or-kill moat) becomes visible:

- **entity**   — every tracked entity named in the event (gazetteer match)
- **theme**    — keyword buckets aligned to the product domains (multi-label)
- **source**   — source family (e.g. `legistar`, `hackernews`)
- **day**      — calendar day bucket

The headline output is the **convergence view**: groups (entity- or theme-keyed)
ranked by how many *distinct sources* corroborate them. A group backed by ≥2
independent sources is the deterministic precursor to a publishable signal — no
embeddings required.

Run: ``python -m high_signal_ingest.grouping --source all --days 7 [--json]``
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field

from . import pipeline
from .extract.entities import gazetteer_match
from .types import Event
from .utils import event_text, source_family  # noqa: F401  (source_family re-exported)


# Keyword → theme buckets. Multi-label: an event can land in several themes.
# Aligned to the three product domains (technology / startups / finance) plus
# the data-center thesis the new sources feed.
THEME_BUCKETS: list[tuple[str, tuple[str, ...]]] = [
    ("ai-infra", ("gpu", "accelerator", "datacenter", "data center", "semiconductor",
                  "hbm", "foundry", "inference", "training", "compute", "cluster", "tpu", "chip")),
    ("energy-power", ("electricity", "power purchase", "megawatt", "substation", "grid",
                      "transmission", "nuclear", "solar", "energy", "kilowatt")),
    ("data-center-buildout", ("rezon", "conditional use", "special exception", "site plan",
                              "development agreement", "hyperscale", "comprehensive plan", "zoning")),
    ("startup-funding", ("funding", "raises", "raised", "seed round", "series a", "series b",
                         "acquisition", "acquires", "ipo", "valuation", "venture", "startup")),
    ("model-release", ("model", "llm", "gpt", "open-weight", "open source", "benchmark",
                       "fine-tune", "release", "checkpoint")),
    ("litigation-regulatory", ("lawsuit", "antitrust", "court", "ruling", "regulation",
                               "patent", "settlement", "fine", "probe", "ban", "sue", "opinion")),
    ("security", ("cve", "vulnerability", "exploit", "breach", "ransomware", "malware", "zero-day")),
    ("developer-tooling", ("framework", "library", "sdk", "kubernetes", "pytorch", "deploy",
                           "api", "runtime", "compiler", "package")),
    ("markets-macro", ("inflation", "treasury", "fed ", "rate cut", "rate hike", "capex",
                       "guidance", "earnings", "demand", "margin")),
]


# Precompile one alternation regex per theme (terms are static) — cheaper than
# scanning every term per event.
_THEME_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (theme, re.compile("|".join(re.escape(t) for t in terms))) for theme, terms in THEME_BUCKETS
]


def classify_themes(text: str) -> list[str]:
    low = text.lower()
    return [theme for theme, pat in _THEME_PATTERNS if pat.search(low)]


@dataclass
class Group:
    key: str
    axis: str  # entity | theme | source | day
    events: int = 0
    sources: set[str] = field(default_factory=set)
    titles: list[str] = field(default_factory=list)


@dataclass
class ConvergenceGroup:
    key: str
    axis: str
    events: int
    distinct_sources: int
    sources: list[str]
    sample_titles: list[str]


def group_events(events: list[Event]) -> dict[str, dict[str, Group]]:
    """Build {axis: {key: Group}} across entity / theme / source / day axes."""
    axes: dict[str, dict[str, Group]] = {
        "entity": {},
        "theme": {},
        "source": {},
        "day": {},
    }

    def add(axis: str, key: str, ev: Event) -> None:
        g = axes[axis].get(key)
        if g is None:
            g = Group(key=key, axis=axis)
            axes[axis][key] = g
        g.events += 1
        g.sources.add(source_family(ev.source))
        if len(g.titles) < 6 and ev.title:
            g.titles.append(ev.title[:120])

    for ev in events:
        text = event_text(ev)
        for eid in gazetteer_match(text):
            add("entity", eid, ev)
        for theme in classify_themes(text):
            add("theme", theme, ev)
        add("source", source_family(ev.source), ev)
        if ev.published_at:
            add("day", ev.published_at.date().isoformat(), ev)

    return axes


def convergence(axes: dict[str, dict[str, Group]], min_sources: int = 2) -> list[ConvergenceGroup]:
    """Entity- and theme-keyed groups ranked by distinct-source corroboration.

    A group spanning ≥ ``min_sources`` independent sources is the deterministic
    precursor to a cite-or-kill-passing signal.
    """
    out: list[ConvergenceGroup] = []
    for axis in ("entity", "theme"):
        for g in axes[axis].values():
            if len(g.sources) < min_sources:
                continue
            out.append(
                ConvergenceGroup(
                    key=g.key,
                    axis=axis,
                    events=g.events,
                    distinct_sources=len(g.sources),
                    sources=sorted(g.sources),
                    sample_titles=g.titles,
                )
            )
    out.sort(key=lambda c: (c.distinct_sources, c.events), reverse=True)
    return out


def summarize(axes: dict[str, dict[str, Group]]) -> dict[str, object]:
    return {
        "total_events": sum(g.events for g in axes["source"].values()),
        "distinct_entities": len(axes["entity"]),
        "distinct_themes": len(axes["theme"]),
        "distinct_sources": len(axes["source"]),
        "events_per_source": {
            k: g.events for k, g in sorted(axes["source"].items(), key=lambda kv: kv[1].events, reverse=True)
        },
        "events_per_theme": {
            k: g.events for k, g in sorted(axes["theme"].items(), key=lambda kv: kv[1].events, reverse=True)
        },
    }


def run(source: str, days: int, min_sources: int) -> dict[str, object]:
    events = pipeline.fetch(source, days)  # type: ignore[arg-type]
    axes = group_events(events)
    conv = convergence(axes, min_sources=min_sources)
    return {"summary": summarize(axes), "convergence": [asdict(c) for c in conv]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Group ingested events deterministically (no RAG).")
    parser.add_argument("--source", default="all")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--min-sources", type=int, default=2, help="convergence corroboration floor")
    parser.add_argument("--json", action="store_true")
    argv = [arg for arg in sys.argv[1:] if arg != "--"]
    args = parser.parse_args(argv)

    result = run(args.source, args.days, args.min_sources)
    if args.json:
        print(json.dumps(result, indent=2))
        return

    s = result["summary"]
    print(
        f"events={s['total_events']} entities={s['distinct_entities']} "
        f"themes={s['distinct_themes']} sources={s['distinct_sources']}"
    )
    print("\nevents per theme:")
    for theme, n in s["events_per_theme"].items():  # type: ignore[union-attr]
        print(f"  {theme:24} {n}")
    print(f"\nconvergence (groups with ≥{args.min_sources} distinct sources):")
    for c in result["convergence"]:  # type: ignore[union-attr]
        print(f"  [{c['axis']}] {c['key']:22} {c['distinct_sources']} sources, {c['events']} events  {c['sources']}")
        for t in c["sample_titles"][:2]:
            print(f"       - {t}")


if __name__ == "__main__":
    main()
