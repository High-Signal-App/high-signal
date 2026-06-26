"""Orchestrator: source → events → cluster by entity → auto-published signal."""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable, Literal
from urllib.parse import urlsplit

from . import audit
from .extract.entities import primary_entity
from .graph import spillover_ids
from .seed import load_entities
from .sources import (
    bluesky,
    cisa_kev,
    companies_house,
    courtlistener,
    edgar,
    eia,
    gdelt,
    github,
    github_archive,
    gov,
    gov_contracts,
    guardian,
    hackernews,
    huggingface,
    hkex,
    ir,
    jobs,
    legistar,
    lobsters,
    macro_rates,
    markets,
    metaculus,
    news,
    nvd,
    openstates,
    package_registries,
    patents,
    podcast_index,
    reddit,
    regulations,
    sec_xbrl,
    semantic_scholar,
    stackexchange,
    substack,
    techmeme,
    wikidata,
    youtube,
)
from .types import Event
from .dedupe import dedupe_exact
from .generator import fallback_candidate, generate, thematic_candidate
from .writer import emit

Source = Literal[
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
    "markets",
    "cisa-kev",
    "lobsters",
    "substack",
    "techmeme",
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
    "eia",
    "all",
]

FALLBACK_DRAFT_LIMIT = 3
DEFAULT_DAILY_EDGAR_TICKER_LIMIT = 25
DEFAULT_SIGNAL_CLUSTER_LIMIT = 40

# Bounded-concurrency fetch tuning (all env-overridable).
DEFAULT_FETCH_CONCURRENCY = 8  # max source adapters in flight at once
DEFAULT_PER_HOST_CONCURRENCY = 1  # never hit one host from >1 adapter at once
DEFAULT_FETCH_RETRIES = 3  # attempts per adapter on transient failure
DEFAULT_FETCH_BACKOFF_BASE = 0.75  # seconds; exponential with full jitter
DEFAULT_FETCH_BACKOFF_CAP = 20.0  # seconds; ceiling on a single backoff sleep

_log = logging.getLogger(__name__)


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def _host_key(url: str | None) -> str:
    """Registrable-ish host key so adapters on the same provider share a slot.

    Collapses subdomains to the last two labels (e.g. ``efts.sec.gov`` and
    ``www.sec.gov`` both map to ``sec.gov``) so SEC/EDGAR adapters never run
    concurrently against the same provider and trip its rate limits.
    """
    if not url:
        return "_none"
    host = (urlsplit(url).hostname or "").lower()
    if not host:
        return "_none"
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


class _HostGate:
    """Per-host bounded concurrency, lazily creating one semaphore per host."""

    def __init__(self, per_host: int) -> None:
        self._per_host = max(1, per_host)
        self._lock = threading.Lock()
        self._sems: dict[str, threading.Semaphore] = {}

    def _sem(self, host: str) -> threading.Semaphore:
        with self._lock:
            sem = self._sems.get(host)
            if sem is None:
                sem = threading.Semaphore(self._per_host)
                self._sems[host] = sem
            return sem

    def run(self, host: str, fn: Callable[[], list[Event]]) -> list[Event]:
        sem = self._sem(host)
        with sem:
            return fn()


def _with_backoff(
    name: str,
    fn: Callable[[], list[Event]],
    *,
    retries: int,
    base: float,
    cap: float,
    failures: list[str],
) -> list[Event]:
    """Run ``fn`` with bounded retries and exponential full-jitter backoff.

    Stdlib-only (tenacity is not a dependency of this package). The final
    failure is swallowed (returns ``[]``) and appended to ``failures`` — a
    single flaky source must never abort the rest of the run, but the caller
    still surfaces it via the run's ``errors``/``error_sample`` audit fields.
    """
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — isolate per-source failures
            attempt += 1
            if attempt >= retries:
                _log.warning("source %s failed after %d attempts: %s", name, attempt, exc)
                failures.append(f"{name}: {exc}")
                return []
            sleep_for = min(cap, base * (2 ** (attempt - 1)))
            sleep_for = random.uniform(0, sleep_for)  # full jitter to spread 429s
            _log.info(
                "source %s attempt %d failed (%s); retrying in %.2fs",
                name,
                attempt,
                exc,
                sleep_for,
            )
            time.sleep(sleep_for)


def _fetch_tasks(source: Source, days: int) -> list[tuple[str, str, Callable[[], list[Event]]]]:
    """Build ``(name, host_key, callable)`` descriptors for the selected sources.

    Each callable encapsulates the per-source window/cap logic so the executor
    can run them concurrently. Existing env caps (e.g. ``EDGAR_TICKER_LIMIT``)
    are honoured here exactly as before.
    """
    tasks: list[tuple[str, str, Callable[[], list[Event]]]] = []

    def add(name: str, host: str, fn: Callable[[], list[Event]]) -> None:
        tasks.append((name, _host_key(host), fn))

    if source in {"edgar", "all"}:
        def _edgar() -> list[Event]:
            tickers = [e.ticker for e in load_entities() if e.ticker and e.type == "public"]
            ticker_limit = _int_env("EDGAR_TICKER_LIMIT", DEFAULT_DAILY_EDGAR_TICKER_LIMIT)
            # Daily stays 8-K only; wider runs add capital/ownership forms and Form D search.
            if days >= 7:
                return edgar.fetch_expanded(tickers[:ticker_limit], days=days)
            return edgar.fetch_recent(tickers[:ticker_limit], days=days, forms=("8-K",))

        add("edgar", "https://www.sec.gov", _edgar)
    if source in {"news", "all"}:
        add("news", "https://newsapi.org", lambda: news.fetch_all(days=days, tier_max=2, fetch_body=True))
    if source in {"reddit", "all"}:
        add("reddit", "https://www.reddit.com", lambda: reddit.fetch_all(days=days))
    if source in {"ir", "all"}:
        add("ir", "https://www.ir.example", lambda: ir.fetch_all())
    if source in {"github", "all"}:
        add("github", "https://api.github.com", lambda: github.fetch_all(days=max(days, 7)))
    if source in {"github-archive", "all"}:
        add("github-archive", "https://data.gharchive.org", lambda: github_archive.fetch_all(days=days))
    if source in {"gov", "all"}:
        add("gov", "https://www.federalregister.gov", lambda: gov.fetch_all(days=max(days, 3)))
    if source in {"huggingface", "all"}:
        add("huggingface", "https://huggingface.co", lambda: huggingface.fetch_all(days=max(days, 7)))
    if source in {"youtube", "all"}:
        add("youtube", "https://www.youtube.com", lambda: youtube.fetch_all(days=max(days, 7)))
    if source in {"bluesky", "all"}:
        add("bluesky", "https://bsky.social", lambda: bluesky.fetch_all(days=max(days, 7)))
    if source in {"gdelt", "all"}:
        # Smaller default for daily; backfill driver pulls bigger windows
        add(
            "gdelt",
            "https://api.gdeltproject.org",
            lambda: gdelt.fetch_all(days=max(days, 1), max_records_per_query=100),
        )
    if source in {"hkex", "all"}:
        add("hkex", "https://www1.hkexnews.hk", lambda: hkex.fetch_all(days=max(days, 3)))
    if source in {"markets", "all"}:
        def _markets() -> list[Event]:
            market_events, market_quotes = markets.fetch_all(days=max(days, 30))
            # Quotes are the primary output of the markets source — push directly.
            pushed = markets.push_quotes(market_quotes)
            if pushed:
                _log.info("markets: pushed %d quotes (of %d)", pushed, len(market_quotes))
            return market_events

        add("markets", "https://gamma-api.polymarket.com", _markets)
    if source in {"cisa-kev", "all"}:
        add("cisa-kev", "https://www.cisa.gov", lambda: cisa_kev.fetch_all(days=max(days, 7)))
    if source in {"lobsters", "all"}:
        add("lobsters", "https://lobste.rs", lambda: lobsters.fetch_all(days=max(days, 3)))
    if source in {"substack", "all"}:
        add("substack", "https://substack.com", lambda: substack.fetch_all(days=max(days, 7)))
    if source in {"techmeme", "all"}:
        add("techmeme", "https://www.techmeme.com", lambda: techmeme.fetch_all(days=max(days, 3)))
    if source in {"packages", "all"}:
        add("packages", "https://www.npmjs.com", lambda: package_registries.fetch_all(days=max(days, 7)))
    if source in {"jobs", "all"}:
        add("jobs", "https://boards.greenhouse.io", lambda: jobs.fetch_all(days=max(days, 14)))
    if source in {"nvd", "all"}:
        add("nvd", "https://services.nvd.nist.gov", lambda: nvd.fetch_all(days=max(days, 14)))
    if source in {"guardian", "all"}:
        add("guardian", "https://content.guardianapis.com", lambda: guardian.fetch_all(days=max(days, 7)))
    if source in {"patents", "all"}:
        add("patents", "https://api.patentsview.org", lambda: patents.fetch_all(days=max(days, 365)))
    if source in {"gov-contracts", "all"}:
        add("gov-contracts", "https://api.www.sbir.gov", lambda: gov_contracts.fetch_all(days=max(days, 30)))
    if source == "wikidata":
        add("wikidata", "https://www.wikidata.org", lambda: wikidata.fetch_all(days=days))
    if source in {"semantic-scholar", "all"}:
        add(
            "semantic-scholar",
            "https://api.semanticscholar.org",
            lambda: semantic_scholar.fetch_all(days=max(days, 30)),
        )
    if source in {"regulations", "all"}:
        add("regulations", "https://api.regulations.gov", lambda: regulations.fetch_all(days=max(days, 30)))
    if source == "companies-house":
        add(
            "companies-house",
            "https://api.company-information.service.gov.uk",
            lambda: companies_house.fetch_all(days=days),
        )
    if source in {"metaculus", "all"}:
        add("metaculus", "https://www.metaculus.com", lambda: metaculus.fetch_all(days=max(days, 30)))
    if source in {"podcast-index", "all"}:
        add("podcast-index", "https://api.podcastindex.org", lambda: podcast_index.fetch_all(days=max(days, 14)))
    if source in {"macro-rates", "all"}:
        add("macro-rates", "https://www.ecb.europa.eu", lambda: macro_rates.fetch_all(days=max(days, 30)))
    if source in {"sec-xbrl", "all"}:
        # Shares the sec.gov host gate with `edgar` so the two never hammer SEC together.
        add("sec-xbrl", "https://www.sec.gov", lambda: sec_xbrl.fetch_all(days=max(days, 120)))
    if source in {"legistar", "all"}:
        # Municipal land-use moves slowly; widen the window so daily runs still
        # catch newly-introduced data-center / fab / rezoning matters.
        add("legistar", "https://webapi.legistar.com", lambda: legistar.fetch_all(days=max(days, 30)))
    if source in {"courtlistener", "all"}:
        # Litigation moves slowly; widen the window so daily runs catch newly
        # filed antitrust / IP / M&A opinions.
        add("courtlistener", "https://www.courtlistener.com", lambda: courtlistener.fetch_all(days=max(days, 30)))
    if source in {"openstates", "all"}:
        # Skipped without OPENSTATES_API_KEY; state bills move on a weeks cadence.
        add("openstates", "https://v3.openstates.org", lambda: openstates.fetch_all(days=max(days, 30)))
    if source in {"hackernews", "all"}:
        add("hackernews", "https://hn.algolia.com", lambda: hackernews.fetch_all(days=max(days, 7)))
    if source in {"stackexchange", "all"}:
        add("stackexchange", "https://api.stackexchange.com", lambda: stackexchange.fetch_all(days=max(days, 30)))
    if source in {"eia", "all"}:
        # Skipped without EIA_API_KEY; monthly series, so widen the window.
        add("eia", "https://api.eia.gov", lambda: eia.fetch_all(days=max(days, 120)))

    return tasks


def fetch(source: Source, days: int, failures: list[str] | None = None) -> list[Event]:
    """Fetch all selected sources concurrently with bounded, per-host-capped I/O.

    Adapters are independent network jobs (most sync, a few async-wrapped); we
    fan them out across a thread pool capped by ``FETCH_CONCURRENCY`` while a
    per-host semaphore (``FETCH_PER_HOST_CONCURRENCY``) serialises adapters that
    hit the same provider. Each adapter call retries transient failures with
    exponential full-jitter backoff to ride out 429s without aborting the run.

    Per-source failures that exhaust their retries are appended (as
    ``"<source>: <error>"`` strings) to ``failures`` when provided, so the
    caller can record them in the run audit without one bad source killing the
    rest of the batch.
    """
    sink: list[str] = failures if failures is not None else []
    tasks = _fetch_tasks(source, days)
    if not tasks:
        return []

    concurrency = min(_int_env("FETCH_CONCURRENCY", DEFAULT_FETCH_CONCURRENCY), len(tasks))
    per_host = _int_env("FETCH_PER_HOST_CONCURRENCY", DEFAULT_PER_HOST_CONCURRENCY)
    retries = _int_env("FETCH_RETRIES", DEFAULT_FETCH_RETRIES)
    base = _float_env("FETCH_BACKOFF_BASE", DEFAULT_FETCH_BACKOFF_BASE)
    cap = _float_env("FETCH_BACKOFF_CAP", DEFAULT_FETCH_BACKOFF_CAP)

    gate = _HostGate(per_host)
    out: list[Event] = []

    def _run(name: str, host: str, fn: Callable[[], list[Event]]) -> list[Event]:
        return gate.run(
            host,
            lambda: _with_backoff(name, fn, retries=retries, base=base, cap=cap, failures=sink),
        )

    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="ingest-fetch") as pool:
        futures = {pool.submit(_run, name, host, fn): name for name, host, fn in tasks}
        for future in as_completed(futures):
            events = future.result()  # _with_backoff swallows exceptions -> [] on failure
            if events:
                out.extend(events)
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


# Themes that publish as entity-less thematic signals → (theme_entity_id, signal_type).
_THEME_SIGNALS: dict[str, tuple[str, str]] = {
    "data-center-buildout": ("THEME_DATACENTER", "data_center_buildout"),
}
_THEMATIC_DRAFT_LIMIT = 5


def _emit_thematic_drafts(events: list[Event]) -> list[str]:
    """Cluster entity-less events by theme and emit thematic signal drafts.

    Additive and strictly gated: a theme produces a draft only when its events
    span ≥ 2 distinct sources AND carry ≥ 2 distinct URLs (cite-or-kill), so a
    lone item never publishes on a theme. Bounded by ``_THEMATIC_DRAFT_LIMIT``.
    """
    from .grouping import classify_themes  # lazy: grouping imports this module

    buckets: dict[str, list[Event]] = defaultdict(list)
    for ev in events:
        if not ev.source_url:
            continue
        themes = classify_themes(f"{ev.title or ''}\n{(ev.content or '')[:600]}")
        for theme in themes:
            if theme in _THEME_SIGNALS:
                buckets[theme].append(ev)

    written: list[str] = []
    for theme, evs in buckets.items():
        if len(written) >= _THEMATIC_DRAFT_LIMIT:
            break
        evs = dedupe_exact(evs)
        sources = {e.source.split(":", 1)[0] for e in evs}
        urls = {e.source_url for e in evs if e.source_url}
        if len(sources) < 2 or len(urls) < 2:
            continue
        entity_id, signal_type = _THEME_SIGNALS[theme]
        cand = thematic_candidate(entity_id, signal_type, evs)
        if cand:
            written.append(emit(cand))
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

    fetch_failures: list[str] = []
    try:
        events = fetch(source, days, failures=fetch_failures)
    except Exception as exc:
        events = []
        errors += 1
        error_sample = f"fetch: {exc}"[:300]
    if fetch_failures:
        errors += len(fetch_failures)
        if error_sample is None:
            error_sample = f"fetch: {fetch_failures[0]}"[:300]

    # Persist raw events for replay/debug regardless of downstream outcome
    audit.push_events(events, fetch_run_id)

    # Collapse exact duplicates (same canonical URL re-reported across feeds /
    # queries) before clustering — keeps distinct-URL events so a signal's
    # cross-source corroboration is preserved. Raw events above are untouched.
    deduped = dedupe_exact(events)
    duplicates_collapsed = len(events) - len(deduped)

    by_entity: dict[str, list[Event]] = defaultdict(list)
    no_entity_events: list[Event] = []
    for ev in deduped:
        eid = _event_entity(ev)
        if eid:
            by_entity[eid].append(ev)
        else:
            no_entity_events.append(ev)
    no_entity = len(no_entity_events)

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

    # Thematic signals from entity-less events (additive; never touches the
    # entity path above). Strictly gated by cite-or-kill — see _emit_thematic_drafts.
    thematic_written = _emit_thematic_drafts(no_entity_events)
    written.extend(thematic_written)

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
        "duplicates_collapsed": duplicates_collapsed,
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
            "github-archive",
            "youtube",
            "bluesky",
            "gov",
            "gdelt",
            "hkex",
            "markets",
            "cisa-kev",
            "lobsters",
            "substack",
            "techmeme",
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
            "eia",
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
