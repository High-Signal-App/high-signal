#!/usr/bin/env python3
"""Backtest the convergence breakout/divergence labels.

For each historical day D in the last `BACKTEST_DAYS`, we replay what the
labels *would* have been at that point in time using the same production
logic, then check whether the labeled entity had a published signal in the
following 24h.

Run from repo root:
    uv run --project python/ingest python scripts/backtest-convergence-labels.py

Output:
- ``/tmp/backtest_convergence.csv`` — one row per (day, entity) with label + outcome
- stdout summary table — confusion matrix per label
"""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx


REPO = Path(__file__).resolve().parents[1]

BACKTEST_DAYS = 14            # how many days to evaluate
DATA_WINDOW_DAYS = 21          # how much history to pull (covers backtest + attention's 14-day window)
WIKI_UA = "high-signal-backtest/0.1 (contact: sarthak@vaultwealth.com)"
MIN_SOURCES = 3
ATTENTION_BREAKOUT_DELTA_PCT = 15.0
ATTENTION_FLAT_BAND_PCT = 5.0


# ─── data pulls ───────────────────────────────────────────────────────────


def wrangler_query(sql: str) -> list[dict]:
    """Run a SQL query against the remote D1 via wrangler. Returns rows."""
    result = subprocess.run(
        [
            "pnpm", "--filter", "@high-signal/db", "exec",
            "wrangler", "d1", "execute", "high-signal-db",
            "--remote", "--json", "--command", sql,
        ],
        capture_output=True, text=True, cwd=REPO,
    )
    if result.returncode != 0:
        sys.stderr.write(f"wrangler error: {result.stderr}\n")
        sys.exit(1)
    data = json.loads(result.stdout)
    return (data[0] if isinstance(data, list) else data)["results"]


def fetch_attention_series(article: str, days: int = DATA_WINDOW_DAYS) -> list[tuple[str, int]]:
    """Pull Wikipedia daily pageviews for the article. Returns [(YYYY-MM-DD, views), …]."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    fmt = lambda d: d.strftime("%Y%m%d")
    url = (
        f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
        f"en.wikipedia/all-access/all-agents/{httpx.QueryParams({'a': article})['a']}/daily/"
        f"{fmt(start)}/{fmt(end)}"
    )
    try:
        r = httpx.get(
            url.replace("?a=", "").replace("&a=", ""),
            headers={"User-Agent": WIKI_UA, "Accept": "application/json"},
            timeout=20.0,
        )
        if r.status_code != 200:
            return []
        items = r.json().get("items", [])
        return [(it["timestamp"][:8], int(it["views"])) for it in items]
    except Exception:
        return []


def wiki_article_from_url(url: Optional[str]) -> Optional[str]:
    if not url or "/wiki/" not in url:
        return None
    return url.split("/wiki/", 1)[1].split("?")[0].split("#")[0]


# ─── label logic (mirrors workers/api/src/routes/convergence.ts) ──────────


def trend_for_series(
    series_by_date: dict[str, int],
    as_of: datetime,
) -> Optional[tuple[float, str]]:
    """Return (deltaPct, direction) given a daily series and a cutoff date.

    Same window the production worker uses: last-7-day avg vs prior-7-day avg.
    """
    recent_days = [(as_of - timedelta(days=i)).strftime("%Y%m%d") for i in range(7)]
    prior_days = [(as_of - timedelta(days=i)).strftime("%Y%m%d") for i in range(7, 14)]
    recent = [series_by_date[d] for d in recent_days if d in series_by_date]
    prior = [series_by_date[d] for d in prior_days if d in series_by_date]
    if len(recent) < 5 or len(prior) < 5:
        return None
    recent_avg = sum(recent) / len(recent)
    prior_avg = sum(prior) / len(prior)
    if prior_avg == 0:
        return None
    delta = (recent_avg - prior_avg) / prior_avg * 100
    direction = (
        "flat" if abs(delta) < ATTENTION_FLAT_BAND_PCT
        else ("up" if delta > 0 else "down")
    )
    return (delta, direction)


def label_for(
    source_count: int,
    trend: Optional[tuple[float, str]],
) -> Optional[str]:
    if source_count < MIN_SOURCES or trend is None:
        return None
    delta, direction = trend
    if direction == "up" and delta >= ATTENTION_BREAKOUT_DELTA_PCT:
        return "breakout"
    if direction == "down":
        return "divergence"
    return None


# ─── main ────────────────────────────────────────────────────────────────


def main() -> int:
    print(f"backtest window: last {BACKTEST_DAYS} days  (data pull: {DATA_WINDOW_DAYS}d)", file=sys.stderr)

    print("[1/4] pulling events + signals from D1…", file=sys.stderr)
    events = wrangler_query(
        f"SELECT primary_entity_id, source, published_at "
        f"FROM events "
        f"WHERE primary_entity_id IS NOT NULL "
        f"  AND published_at >= unixepoch() - {DATA_WINDOW_DAYS}*86400"
    )
    signals = wrangler_query(
        f"SELECT primary_entity_id, published_at, review_status, signal_type "
        f"FROM signals "
        f"WHERE published_at >= unixepoch() - {DATA_WINDOW_DAYS}*86400"
    )
    entities_seed = json.loads(
        (REPO / "workers/api/src/lib/seed-entities.json").read_text()
    )
    wiki_by_id = {e["id"]: wiki_article_from_url(e.get("wiki_url")) for e in entities_seed}
    print(f"  events={len(events):,}  signals={len(signals)}  entities_with_wiki={sum(1 for v in wiki_by_id.values() if v)}", file=sys.stderr)

    # Group events by (entity_id, day) → set of sources
    print("[2/4] reshaping events by (entity, day)…", file=sys.stderr)
    events_by_entity: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for ev in events:
        eid = ev["primary_entity_id"]
        events_by_entity[eid].append((int(ev["published_at"]), ev["source"]))
    for eid in events_by_entity:
        events_by_entity[eid].sort()

    # Map (entity_id, published_at) → published signal
    signals_by_entity: dict[str, list[int]] = defaultdict(list)
    for s in signals:
        if s.get("review_status") in ("draft", "killed"):
            continue  # only count published / corrected as "real" outcomes
        signals_by_entity[s["primary_entity_id"]].append(int(s["published_at"]))

    # Determine the set of entities that ever crossed ≥3 sources in any 24h
    # window during the backtest period — these are the only ones worth
    # fetching attention for. (Saves Wikipedia API calls.)
    now = datetime.now(timezone.utc)
    backtest_start = now - timedelta(days=BACKTEST_DAYS)
    candidates: set[str] = set()
    for eid, evs in events_by_entity.items():
        if not evs:
            continue
        # Any 24h sliding window with ≥3 distinct sources?
        latest = evs[-1][0]
        if latest < backtest_start.timestamp() - 24 * 3600:
            continue
        # Just check the full window — if total distinct sources ≥3 within
        # the entire backtest period, the entity is a candidate.
        sources = {s for ts, s in evs if ts >= backtest_start.timestamp()}
        if len(sources) >= MIN_SOURCES:
            candidates.add(eid)

    print(f"  {len(candidates)} candidate entities for attention fetch", file=sys.stderr)

    # Fetch attention series per candidate entity (one Wikipedia call each)
    print("[3/4] fetching Wikipedia attention for candidates…", file=sys.stderr)
    attention_by_entity: dict[str, dict[str, int]] = {}
    for i, eid in enumerate(sorted(candidates)):
        article = wiki_by_id.get(eid)
        if not article:
            continue
        series = fetch_attention_series(article)
        if series:
            attention_by_entity[eid] = dict(series)
        if (i + 1) % 25 == 0:
            print(f"    {i+1}/{len(candidates)}…", file=sys.stderr)
        time.sleep(0.05)  # be polite to Wikimedia
    print(f"  attention fetched for {len(attention_by_entity)} entities", file=sys.stderr)

    # Backtest loop
    print(f"[4/4] backtesting last {BACKTEST_DAYS} days…", file=sys.stderr)
    rows: list[dict] = []
    for d in range(BACKTEST_DAYS):
        cutoff = now - timedelta(days=BACKTEST_DAYS - d - 1)  # end of day D
        cutoff_ts = int(cutoff.timestamp())
        window_start_ts = cutoff_ts - 24 * 3600

        for eid, evs in events_by_entity.items():
            sources_in_window = {s for ts, s in evs if window_start_ts <= ts <= cutoff_ts}
            if len(sources_in_window) < MIN_SOURCES:
                continue

            trend = None
            attn_series = attention_by_entity.get(eid)
            if attn_series:
                trend = trend_for_series(attn_series, cutoff)

            label = label_for(len(sources_in_window), trend)

            # Outcome: signal published in (cutoff, cutoff + 24h]?
            signal_dates = signals_by_entity.get(eid, [])
            next_24h_signal = any(
                cutoff_ts < s_ts <= cutoff_ts + 24 * 3600 for s_ts in signal_dates
            )

            rows.append({
                "day": cutoff.strftime("%Y-%m-%d"),
                "entity": eid,
                "source_count": len(sources_in_window),
                "trend_delta_pct": f"{trend[0]:.1f}" if trend else "",
                "trend_dir": trend[1] if trend else "",
                "label": label or "",
                "next_24h_signal": int(next_24h_signal),
            })

    # Write CSV
    out_path = Path("/tmp/backtest_convergence.csv")
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["day"])
        w.writeheader()
        w.writerows(rows)

    # Summarize
    print(f"\n=== {len(rows)} (entity, day) observations ===\n")

    def summarize(label_filter: Optional[str], desc: str) -> None:
        matching = [r for r in rows if (r["label"] == label_filter) if label_filter is not None] if label_filter is not None else \
                   [r for r in rows if r["label"] == ""]
        # Special case: None means "no label" (empty string)
        if label_filter is None:
            matching = [r for r in rows if r["label"] == ""]
        elif label_filter == "ANY":
            matching = rows
        else:
            matching = [r for r in rows if r["label"] == label_filter]
        n = len(matching)
        hits = sum(r["next_24h_signal"] for r in matching)
        rate = hits / n if n else 0
        print(f"  {desc:<26} n={n:<5} hit={hits:<5} rate={rate*100:.1f}%")

    summarize("breakout", "label=breakout")
    summarize("divergence", "label=divergence")
    summarize(None, "label=(none, converged)")
    summarize("ANY", "all converged (baseline)")

    # Wikipedia-coverage diagnostic: how often did we have attention data?
    with_trend = [r for r in rows if r["trend_dir"]]
    print(f"\n  rows with attention trend data: {len(with_trend):,} / {len(rows):,}")
    print(f"  CSV written to: {out_path}")

    # Compute summary stats and write JSON for the Worker to import.
    def stats(matching: list[dict]) -> dict:
        n = len(matching)
        hits = sum(r["next_24h_signal"] for r in matching)
        rate = hits / n if n else 0.0
        return {"n": n, "hits": hits, "rate": round(rate, 4)}

    breakout_stats = stats([r for r in rows if r["label"] == "breakout"])
    divergence_stats = stats([r for r in rows if r["label"] == "divergence"])
    unlabeled_stats = stats([r for r in rows if r["label"] == ""])
    baseline_stats = stats(rows)

    def lift(s: dict) -> Optional[float]:
        if not s["n"] or not baseline_stats["rate"]:
            return None
        return round(s["rate"] / baseline_stats["rate"], 3)

    summary = {
        "generatedAt": now.isoformat(),
        "backtestDays": BACKTEST_DAYS,
        "labels": {
            "breakout": {**breakout_stats, "lift": lift(breakout_stats)},
            "divergence": {**divergence_stats, "lift": lift(divergence_stats)},
        },
        "unlabeled": unlabeled_stats,
        "baseline": baseline_stats,
    }
    worker_path = REPO / "workers/api/src/lib/label-backtest.json"
    worker_path.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"  Summary JSON: {worker_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
