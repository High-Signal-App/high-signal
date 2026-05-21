"""Backfill driver — replay historical events through the live pipeline.

  uv run python -m high_signal_ingest.backfill --start 2025-04-25 --end 2026-04-25 --sources gdelt,edgar
  uv run python -m high_signal_ingest.backfill --start 2025-10-01 --end 2025-12-31 --sources gdelt

All pushed signals use a `bf-` slug prefix and body header marker so
/track-record can split live vs backfill hit-rates.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable

from . import audit
from .extract.entities import primary_entity
from .generator import fallback_candidate, generate
from .graph import spillover_ids
from .seed import load_entities
from .sources import edgar, gdelt
from .types import Event, SignalCandidate
from .writer import emit


def _parse_date(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def fetch_historical(sources: Iterable[str], start: datetime, end: datetime) -> list[Event]:
    out: list[Event] = []
    for s in sources:
        if s == "gdelt":
            out.extend(gdelt.fetch_range(start, end))
        elif s == "edgar":
            tickers = [e.ticker for e in load_entities() if e.ticker and e.type == "public"]
            out.extend(edgar.fetch_filings(tickers[:80], start, forms=("8-K", "10-Q")))
        else:
            print(f"[backfill] unsupported source for backfill: {s}")
    return out


def _mark_backfill(c: SignalCandidate) -> SignalCandidate:
    """Stamp body with backfilled marker so it shows up on filtered views."""
    body = c.body_md.strip()
    if not body.startswith("> _backfill_"):
        body = f"> _backfill_ — replayed from historical events\n\n{body}"
    c.body_md = body
    c.slug = f"bf-{c.slug}" if not c.slug.startswith("bf-") else c.slug
    return c


def run(start: datetime, end: datetime, sources: list[str], window_chunk_days: int = 7) -> dict:
    """Walk the date range in `window_chunk_days` chunks, ingest each."""
    started_at = datetime.now(timezone.utc)
    fetch_run_id = f"bf-{audit.new_run_id()}"

    total_events = 0
    total_drafted = 0
    total_low_cluster = 0
    total_no_entity = 0
    errors = 0

    cursor = start
    while cursor < end:
        chunk_end = min(end, cursor.replace(microsecond=0) + _td_days(window_chunk_days))
        try:
            events = fetch_historical(sources, cursor, chunk_end)
        except Exception as exc:
            errors += 1
            print(f"[backfill] chunk {cursor}–{chunk_end} fetch failed: {exc}")
            cursor = chunk_end
            continue
        total_events += len(events)
        audit.push_events(events, fetch_run_id)

        by_entity: dict[str, list[Event]] = defaultdict(list)
        for ev in events:
            eid = ev.primary_entity_id
            if not eid:
                text = f"{ev.title or ''}\n{(ev.content or '')[:4000]}"
                eid = primary_entity(text)
            if eid:
                by_entity[eid].append(ev)
            else:
                total_no_entity += 1

        for entity_id, evs in by_entity.items():
            try:
                cand = generate(entity_id, evs, spillover_ids(entity_id, hops=2, limit=12))
            except Exception as exc:
                errors += 1
                print(f"[backfill] generate failed entity={entity_id}: {exc}")
                cand = fallback_candidate(entity_id, evs, spillover_ids(entity_id, hops=2, limit=12))
            if not cand:
                cand = fallback_candidate(entity_id, evs, spillover_ids(entity_id, hops=2, limit=12))
            if cand:
                # Critical for backfill scoring: the signal's `published_at`
                # must equal the *latest source event date*, not generation
                # time, so its forward-return window is already matured and
                # yfinance can compute hit/miss today.
                cand.published_at = max(e.published_at for e in evs)
                _mark_backfill(cand)
                emit(cand)
                total_drafted += 1
        print(
            f"[backfill] {cursor.date()} → {chunk_end.date()}  "
            f"events={len(events)}  drafted={total_drafted}",
        )
        cursor = chunk_end

    audit.push_ingest_run(
        source=f"backfill:{','.join(sources)}",
        started_at=started_at,
        days=(end - start).days,
        events_fetched=total_events,
        events_dropped_no_entity=total_no_entity,
        events_dropped_low_cluster=total_low_cluster,
        signals_drafted=total_drafted,
        errors=errors,
        notes=f"start={start.date()} end={end.date()} fetch_run_id={fetch_run_id}",
    )

    return {
        "fetch_run_id": fetch_run_id,
        "events": total_events,
        "drafted": total_drafted,
        "no_entity": total_no_entity,
        "low_cluster": total_low_cluster,
        "errors": errors,
    }


def _td_days(days: int):
    from datetime import timedelta

    return timedelta(days=days)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--start", required=True, help="ISO date, e.g. 2025-04-25")
    p.add_argument("--end", required=True, help="ISO date, e.g. 2026-04-25")
    p.add_argument("--sources", default="gdelt", help="csv: gdelt,edgar")
    p.add_argument("--chunk-days", type=int, default=7)
    args = p.parse_args()

    out = run(
        _parse_date(args.start),
        _parse_date(args.end),
        [s.strip() for s in args.sources.split(",") if s.strip()],
        window_chunk_days=args.chunk_days,
    )
    print(out)


if __name__ == "__main__":
    main()
