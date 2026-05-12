"""Orchestrator: source → events → cluster by entity → signal candidate → review draft."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from . import audit
from .extract.entities import primary_entity
from .graph import spillover_ids
from .seed import load_entities
from .sources import edgar, gdelt, github, gov, hkex, ir, markets, news, reddit, youtube
from .types import Event
from .generator import generate
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
    "all",
]


def fetch(source: Source, days: int) -> list[Event]:
    out: list[Event] = []
    if source in {"edgar", "all"}:
        tickers = [e.ticker for e in load_entities() if e.ticker and e.type == "public"]
        # 8-K is event-driven; 10-Q/K only checked weekly to keep volume bounded
        forms = ("8-K", "10-Q", "10-K") if days >= 7 else ("8-K",)
        out.extend(edgar.fetch_recent(tickers[:80], days=days, forms=forms))
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
    return out


def _spillover_candidates(primary: str) -> list[str]:
    """Hop-decayed BFS over the relationship graph — top peers/suppliers/customers."""
    return spillover_ids(primary, hops=2, limit=12)


def cluster_and_generate(events: list[Event]) -> list[str]:
    """Cluster events by primary entity, then call LLM to draft signals."""
    by_entity: dict[str, list[Event]] = defaultdict(list)
    for ev in events:
        eid = ev.primary_entity_id
        if not eid:
            text = f"{ev.title or ''}\n{(ev.content or '')[:4000]}"
            eid = primary_entity(text)
        if eid:
            by_entity[eid].append(ev)

    written: list[str] = []
    for entity_id, evs in by_entity.items():
        distinct_urls = {e.source_url for e in evs if e.source_url}
        if len(distinct_urls) < 2:
            continue
        cand = generate(entity_id, evs, _spillover_candidates(entity_id))
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
        eid = ev.primary_entity_id
        if not eid:
            text = f"{ev.title or ''}\n{(ev.content or '')[:4000]}"
            eid = primary_entity(text)
        if eid:
            by_entity[eid].append(ev)
        else:
            no_entity += 1

    written: list[str] = []
    low_cluster = 0
    for entity_id, evs in by_entity.items():
        distinct_urls = {e.source_url for e in evs if e.source_url}
        if len(distinct_urls) < 2:
            low_cluster += 1
            continue
        try:
            cand = generate(entity_id, evs, _spillover_candidates(entity_id))
        except Exception as exc:
            errors += 1
            if error_sample is None:
                error_sample = f"generate {entity_id}: {exc}"[:300]
            continue
        if cand:
            written.append(emit(cand))

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
