"""Orchestrator: source → events → cluster by entity → auto-published signal."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from . import audit
from .extract.entities import primary_entity
from .graph import spillover_ids
from .seed import load_entities
from .sources import cisa_kev, edgar, gdelt, github, gov, hkex, ir, lobsters, markets, news, reddit, techmeme, youtube
from .types import Event
from .generator import fallback_candidate, generate
from .writer import emit

Source = Literal[
    "edgar",
    "news",
    "reddit",
    "ir",
    "github",
    "youtube",
    "gov",
    "gdelt",
    "hkex",
    "markets",
    "cisa-kev",
    "lobsters",
    "techmeme",
    "all",
]

FALLBACK_DRAFT_LIMIT = 3
DEFAULT_DAILY_EDGAR_TICKER_LIMIT = 25
DEFAULT_SIGNAL_CLUSTER_LIMIT = 40


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def fetch(source: Source, days: int) -> list[Event]:
    out: list[Event] = []
    if source in {"edgar", "all"}:
        tickers = [e.ticker for e in load_entities() if e.ticker and e.type == "public"]
        ticker_limit = _int_env("EDGAR_TICKER_LIMIT", DEFAULT_DAILY_EDGAR_TICKER_LIMIT)
        # 8-K is event-driven; 10-Q/K only checked weekly to keep volume bounded
        forms = ("8-K", "10-Q", "10-K") if days >= 7 else ("8-K",)
        out.extend(edgar.fetch_recent(tickers[:ticker_limit], days=days, forms=forms))
    if source in {"news", "all"}:
        out.extend(news.fetch_all(days=days, tier_max=2, fetch_body=True))
    if source in {"reddit", "all"}:
        out.extend(reddit.fetch_all(days=days))
    if source in {"ir", "all"}:
        out.extend(ir.fetch_all())
    if source in {"github", "all"}:
        out.extend(github.fetch_all(days=max(days, 7)))
    if source in {"gov", "all"}:
        out.extend(gov.fetch_all(days=max(days, 3)))
    if source in {"youtube", "all"}:
        out.extend(youtube.fetch_all(days=max(days, 7)))
    if source in {"gdelt", "all"}:
        # Smaller default for daily; backfill driver pulls bigger windows
        out.extend(gdelt.fetch_all(days=max(days, 1), max_records_per_query=100))
    if source in {"hkex", "all"}:
        out.extend(hkex.fetch_all(days=max(days, 3)))
    if source in {"markets", "all"}:
        market_events, market_quotes = markets.fetch_all(days=max(days, 30))
        out.extend(market_events)
        # Quotes are the primary output of the markets source — push directly.
        pushed = markets.push_quotes(market_quotes)
        if pushed:
            import logging

            logging.getLogger(__name__).info(
                "markets: pushed %d quotes (of %d)", pushed, len(market_quotes)
            )
    if source in {"cisa-kev", "all"}:
        out.extend(cisa_kev.fetch_all(days=max(days, 7)))
    if source in {"lobsters", "all"}:
        out.extend(lobsters.fetch_all(days=max(days, 3)))
    if source in {"techmeme", "all"}:
        out.extend(techmeme.fetch_all(days=max(days, 3)))
    return out


def _spillover_candidates(primary: str) -> list[str]:
    """Hop-decayed BFS over the relationship graph — top peers/suppliers/customers."""
    return spillover_ids(primary, hops=2, limit=12)


def _ranked_entity_groups(by_entity: dict[str, list[Event]]) -> list[tuple[str, list[Event]]]:
    """Prioritize clusters with independent URLs and multiple source families."""

    return sorted(
        by_entity.items(),
        key=lambda item: (
            len({e.source.split(":")[0] for e in item[1]}),
            len({e.source_url for e in item[1] if e.source_url}),
            len(item[1]),
        ),
        reverse=True,
    )


def _cluster_limit() -> int:
    return _int_env("SIGNAL_CLUSTER_LIMIT", DEFAULT_SIGNAL_CLUSTER_LIMIT)


def _event_entity(ev: Event) -> str | None:
    if ev.primary_entity_id:
        return ev.primary_entity_id
    # KEV vendor/product names are often short or generic ("Lite", "Core",
    # "Console"). Avoid broad ticker gazetteer matches; the adapter already
    # applies exact vendor/product mapping for tracked entities.
    if ev.source == "cisa-kev":
        return None
    if ev.source.startswith("youtube:"):
        text = f"{ev.title or ''}\n{(ev.content or '')[:600]}"
    else:
        text = f"{ev.title or ''}\n{(ev.content or '')[:4000]}"
    return primary_entity(text)


def cluster_and_generate(events: list[Event]) -> list[str]:
    """Cluster events by primary entity, then call LLM to generate signals."""
    by_entity: dict[str, list[Event]] = defaultdict(list)
    for ev in events:
        eid = _event_entity(ev)
        if eid:
            by_entity[eid].append(ev)

    written: list[str] = []
    for entity_id, evs in _ranked_entity_groups(by_entity)[:_cluster_limit()]:
        cand = generate(entity_id, evs, _spillover_candidates(entity_id))
        if cand:
            written.append(emit(cand))
    if not written:
        written.extend(_emit_fallback_drafts(by_entity))
    return written


def _emit_fallback_drafts(by_entity: dict[str, list[Event]]) -> list[str]:
    """Emit a small fallback batch when model generation yields nothing."""
    written: list[str] = []
    ranked = sorted(
        by_entity.items(),
        key=lambda item: (len({e.source_url for e in item[1] if e.source_url}), len(item[1])),
        reverse=True,
    )
    for entity_id, evs in ranked[:FALLBACK_DRAFT_LIMIT]:
        cand = fallback_candidate(entity_id, evs, _spillover_candidates(entity_id))
        if cand:
            written.append(emit(cand))
    return written


def run(source: Source, days: int) -> dict:
    started_at = datetime.now(timezone.utc)
    fetch_run_id = audit.new_run_id()
    errors = 0
    error_sample: str | None = None

    try:
        events = fetch(source, days)
    except Exception as exc:
        events = []
        errors += 1
        error_sample = f"fetch: {exc}"[:300]

    # Persist raw events for replay/debug regardless of downstream outcome
    audit.push_events(events, fetch_run_id)

    by_entity: dict[str, list[Event]] = defaultdict(list)
    no_entity = 0
    for ev in events:
        eid = _event_entity(ev)
        if eid:
            by_entity[eid].append(ev)
        else:
            no_entity += 1

    written: list[str] = []
    low_cluster = 0
    fallback_by_entity: dict[str, list[Event]] = {}
    for entity_id, evs in _ranked_entity_groups(by_entity)[:_cluster_limit()]:
        try:
            cand = generate(entity_id, evs, _spillover_candidates(entity_id))
        except Exception as exc:
            errors += 1
            if error_sample is None:
                error_sample = f"generate {entity_id}: {exc}"[:300]
            fallback_by_entity[entity_id] = evs
            continue
        if cand:
            written.append(emit(cand))
        else:
            fallback_by_entity[entity_id] = evs

    if not written and fallback_by_entity:
        fallback_written = _emit_fallback_drafts(fallback_by_entity)
        written.extend(fallback_written)

    audit.push_ingest_run(
        source=source,
        started_at=started_at,
        days=days,
        events_fetched=len(events),
        events_dropped_no_entity=no_entity,
        events_dropped_low_cluster=low_cluster,
        signals_drafted=len(written),
        errors=errors,
        error_sample=error_sample,
        notes=f"fetch_run_id={fetch_run_id}",
    )

    return {
        "fetch_run_id": fetch_run_id,
        "events": len(events),
        "events_no_entity": no_entity,
        "events_low_cluster": low_cluster,
        "signals_drafted": len(written),
        "errors": errors,
        "paths": written,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--source",
        choices=[
            "edgar",
            "news",
            "reddit",
            "ir",
            "github",
            "youtube",
            "gov",
            "gdelt",
            "hkex",
            "markets",
            "cisa-kev",
            "lobsters",
            "all",
        ],
        default="all",
    )
    p.add_argument("--days", type=int, default=1)
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit the run summary as a single JSON line (machine-readable).",
    )
    args = p.parse_args()
    out = run(args.source, args.days)
    if args.json:
        print(json.dumps(out, default=str))
    else:
        print(out)
    # Non-zero exit when no events landed AND nothing was drafted, so a
    # silent-failure cron tick surfaces in Modal alerts without parsing logs.
    if out["events"] == 0 and out["signals_drafted"] == 0 and out["errors"] > 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
