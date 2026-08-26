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
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Literal, cast
from urllib.parse import urlsplit

from . import audit, source_catalog
from .extract.entities import primary_entity
from .graph import spillover_ids
from .seed import load_entities
from .sources import (
    ai_benchmarks,
    appstore,
    appstore_reviews,
    bls,
    bluesky,
    cisa_kev,
    china_news,
    coingecko,
    companies_house,
    courtlistener,
    crypto_onchain,
    defillama,
    dev_ecosystems,
    edgar,
    eia,
    gdelt,
    github,
    github_archive,
    global_macro,
    google_trends,
    gov,
    gov_contracts,
    guardian,
    hackernews,
    huggingface,
    hkex,
    india_gov,
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
    playstore_reviews,
    podcast_index,
    producthunt,
    reddit,
    regulations,
    sec_xbrl,
    scmp,
    semantic_scholar,
    stackexchange,
    substack,
    techmeme,
    us_gov_api,
    us_gov_rss,
    wikidata,
    youtube,
)
from .types import Event
from .dedupe import dedupe, dedupe_exact
from .utils import event_text
from .generator import fallback_candidate, generate, generate_batch, thematic_candidate
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
    "china-news",
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
    "scmp",
    "legistar",
    "courtlistener",
    "openstates",
    "hackernews",
    "stackexchange",
    "eia",
    "producthunt",
    "vc-portfolios",
    "coingecko",
    "google-trends",
    "appstore",
    "defillama",
    "bls",
    "appstore-reviews",
    "playstore-reviews",
    "us-gov-rss",
    "us-gov-api",
    "india-gov",
    "global-macro",
    "crypto-onchain",
    "ai-benchmarks",
    "dev-ecosystems",
    "all",
    "context",
    "weekly",
    "monthly",
]


@dataclass(frozen=True)
class FetchReceipt:
    source: str
    started_at: datetime
    finished_at: datetime
    events_fetched: int
    errors: int
    error_sample: str | None = None


FALLBACK_DRAFT_LIMIT = 3
DEFAULT_DAILY_EDGAR_TICKER_LIMIT = 25
DEFAULT_SIGNAL_CLUSTER_LIMIT = 40

# Batch generation: small clusters (≤ this many events) are merged into graph-
# connected groups and sent as one LLM call. Large clusters get their own call
# for quality. Tuned so a typical day's ~40 clusters become ~5-10 LLM calls.
SMALL_CLUSTER_THRESHOLD = 4
MAX_BATCH_ENTITIES = 12  # cap entities per batched call (context-window guard)

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
    grouped = source_catalog.PIPELINE_SOURCE_GROUPS.get(source)
    if grouped is None:
        return _fetch_single_source_tasks(source, days)

    tasks: list[tuple[str, str, Callable[[], list[Event]]]] = []
    for source_id in sorted(grouped):
        tasks.extend(_fetch_single_source_tasks(cast(Source, source_id), days))
    return tasks


def _fetch_single_source_tasks(
    source: Source, days: int
) -> list[tuple[str, str, Callable[[], list[Event]]]]:
    """Build ``(name, host_key, callable)`` descriptors for the selected sources.

    Each callable encapsulates the per-source window/cap logic so the executor
    can run them concurrently. Existing env caps (e.g. ``EDGAR_TICKER_LIMIT``)
    are honoured here exactly as before.
    """
    tasks = []

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
        add(
            "news",
            "https://newsapi.org",
            lambda: news.fetch_all(days=days, tier_max=2, fetch_body=True),
        )
    if source in {"reddit", "all"}:
        add("reddit", "https://www.reddit.com", lambda: reddit.fetch_all(days=days))
    if source in {"ir", "all"}:
        add("ir", "https://www.ir.example", lambda: ir.fetch_all())
    if source in {"github", "all"}:
        add("github", "https://api.github.com", lambda: github.fetch_all(days=max(days, 7)))
    if source in {"github-archive", "all"}:
        add(
            "github-archive",
            "https://data.gharchive.org",
            lambda: github_archive.fetch_all(days=days),
        )
    if source in {"gov", "all"}:
        add("gov", "https://www.federalregister.gov", lambda: gov.fetch_all(days=max(days, 3)))
    if source in {"huggingface", "all"}:
        add(
            "huggingface",
            "https://huggingface.co",
            lambda: huggingface.fetch_all(days=max(days, 7)),
        )
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
    if source in {"china-news", "all"}:
        add("china-news", "https://technode.com", lambda: china_news.fetch_all(days=max(days, 3)))
    if source in {"lobsters", "all"}:
        add("lobsters", "https://lobste.rs", lambda: lobsters.fetch_all(days=max(days, 3)))
    if source in {"substack", "all"}:
        add("substack", "https://substack.com", lambda: substack.fetch_all(days=max(days, 7)))
    if source in {"techmeme", "all"}:
        add("techmeme", "https://www.techmeme.com", lambda: techmeme.fetch_all(days=max(days, 3)))
    if source in {"packages", "all"}:
        add(
            "packages",
            "https://www.npmjs.com",
            lambda: package_registries.fetch_all(days=max(days, 7)),
        )
    if source in {"jobs", "all"}:
        add("jobs", "https://boards.greenhouse.io", lambda: jobs.fetch_all(days=max(days, 14)))
    if source in {"nvd", "all"}:
        add("nvd", "https://services.nvd.nist.gov", lambda: nvd.fetch_all(days=max(days, 14)))
    if source in {"guardian", "all"}:
        add(
            "guardian",
            "https://content.guardianapis.com",
            lambda: guardian.fetch_all(days=max(days, 7)),
        )
    # Parked after the 2026 USPTO ODP migration: the legacy PatentsView URL now
    # redirects to an account-, MFA-, and API-key-gated replacement. Keep the
    # explicit source id as a compatibility probe, but never spend a daily
    # `all` run on an endpoint that is known to yield nothing.
    if source == "patents":
        add(
            "patents", "https://api.patentsview.org", lambda: patents.fetch_all(days=max(days, 365))
        )
    if source in {"gov-contracts", "all"}:
        add(
            "gov-contracts",
            "https://api.www.sbir.gov",
            lambda: gov_contracts.fetch_all(days=max(days, 30)),
        )
    if source == "wikidata":
        add("wikidata", "https://www.wikidata.org", lambda: wikidata.fetch_all(days=days))
    if source in {"semantic-scholar", "all"}:
        add(
            "semantic-scholar",
            "https://api.semanticscholar.org",
            lambda: semantic_scholar.fetch_all(days=max(days, 30)),
        )
    if source in {"regulations", "all"}:
        add(
            "regulations",
            "https://api.regulations.gov",
            lambda: regulations.fetch_all(days=max(days, 30)),
        )
    if source == "companies-house":
        add(
            "companies-house",
            "https://api.company-information.service.gov.uk",
            lambda: companies_house.fetch_all(days=days),
        )
    if source in {"metaculus", "all"}:
        add(
            "metaculus",
            "https://www.metaculus.com",
            lambda: metaculus.fetch_all(days=max(days, 30)),
        )
    if source in {"podcast-index", "all"}:
        add(
            "podcast-index",
            "https://api.podcastindex.org",
            lambda: podcast_index.fetch_all(days=max(days, 14)),
        )
    if source in {"macro-rates", "all"}:
        add(
            "macro-rates",
            "https://www.ecb.europa.eu",
            lambda: macro_rates.fetch_all(days=max(days, 30)),
        )
    if source in {"sec-xbrl", "all"}:
        # Shares the sec.gov host gate with `edgar` so the two never hammer SEC together.
        add("sec-xbrl", "https://www.sec.gov", lambda: sec_xbrl.fetch_all(days=max(days, 120)))
    if source in {"scmp", "all"}:
        add("scmp", "https://www.scmp.com", lambda: scmp.fetch_all(days=max(days, 3)))
    if source in {"legistar", "all"}:
        # Municipal land-use moves slowly; widen the window so daily runs still
        # catch newly-introduced data-center / fab / rezoning matters.
        add(
            "legistar",
            "https://webapi.legistar.com",
            lambda: legistar.fetch_all(days=max(days, 30)),
        )
    if source in {"courtlistener", "all"}:
        # Litigation moves slowly; widen the window so daily runs catch newly
        # filed antitrust / IP / M&A opinions.
        add(
            "courtlistener",
            "https://www.courtlistener.com",
            lambda: courtlistener.fetch_all(days=max(days, 30)),
        )
    if source in {"openstates", "all"}:
        # Skipped without OPENSTATES_API_KEY; state bills move on a weeks cadence.
        add(
            "openstates",
            "https://v3.openstates.org",
            lambda: openstates.fetch_all(days=max(days, 30)),
        )
    if source in {"hackernews", "all"}:
        add("hackernews", "https://hn.algolia.com", lambda: hackernews.fetch_all(days=max(days, 7)))
    if source in {"stackexchange", "all"}:
        add(
            "stackexchange",
            "https://api.stackexchange.com",
            lambda: stackexchange.fetch_all(days=max(days, 30)),
        )
    if source in {"eia", "all"}:
        # Skipped without EIA_API_KEY; monthly series, so widen the window.
        add("eia", "https://api.eia.gov", lambda: eia.fetch_all(days=max(days, 120)))
    if source in {"producthunt", "all"}:
        add(
            "producthunt",
            "https://www.producthunt.com",
            lambda: producthunt.fetch_all(days=max(days, 7)),
        )
    # Parked placeholder: keep the explicit source id for compatibility, but do
    # not advertise a no-op task as a successful daily adapter.
    if source == "vc-portfolios":
        add("vc-portfolios", "https://www.ycombinator.com/companies", lambda: [])
    if source in {"coingecko", "all"}:
        add("coingecko", "https://api.coingecko.com", lambda: coingecko.fetch_all(days=days))
    if source in {"google-trends", "all"}:
        add(
            "google-trends",
            "https://trends.google.com",
            lambda: google_trends.fetch_all(days=max(days, 2)),
        )
    if source in {"appstore", "all"}:
        add(
            "appstore", "https://rss.applemarketingtools.com", lambda: appstore.fetch_all(days=days)
        )
    if source in {"defillama", "all"}:
        add("defillama", "https://api.llama.fi", lambda: defillama.fetch_all(days=days))
    if source in {"bls", "all"}:
        add("bls", "https://api.bls.gov", lambda: bls.fetch_all(days=max(days, 120)))
    if source in {"appstore-reviews", "all"}:
        add(
            "appstore-reviews",
            "https://itunes.apple.com",
            lambda: appstore_reviews.fetch_all(days=max(days, 14)),
        )
    if source in {"playstore-reviews", "all"}:
        add(
            "playstore-reviews",
            "https://play.google.com",
            lambda: playstore_reviews.fetch_all(days=max(days, 14)),
        )
    if source in {"us-gov-rss", "all"}:
        add("us-gov-rss", "https://www.sec.gov", lambda: us_gov_rss.fetch_all(days=max(days, 7)))
    if source in {"us-gov-api", "all"}:
        add("us-gov-api", "https://api.bls.gov", lambda: us_gov_api.fetch_all(days=max(days, 30)))
    if source in {"india-gov", "all"}:
        add("india-gov", "https://www.sebi.gov.in", lambda: india_gov.fetch_all(days=max(days, 3)))
    if source in {"global-macro", "all"}:
        add(
            "global-macro",
            "https://api.worldbank.org",
            lambda: global_macro.fetch_all(days=max(days, 30)),
        )
    if source in {"crypto-onchain", "all"}:
        add("crypto-onchain", "https://mempool.space", lambda: crypto_onchain.fetch_all(days=days))
    if source in {"ai-benchmarks", "all"}:
        add("ai-benchmarks", "https://api.wulong.dev", lambda: ai_benchmarks.fetch_all(days=days))
    if source in {"dev-ecosystems", "all"}:
        add(
            "dev-ecosystems",
            "https://paperswithcode.com",
            lambda: dev_ecosystems.fetch_all(days=max(days, 7)),
        )

    return tasks


def fetch(
    source: Source,
    days: int,
    failures: list[str] | None = None,
    receipts: list[FetchReceipt] | None = None,
) -> list[Event]:
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

    def _run(
        name: str, host: str, fn: Callable[[], list[Event]]
    ) -> tuple[list[Event], FetchReceipt, list[str]]:
        started_at = datetime.now(timezone.utc)
        local_failures: list[str] = []
        events = gate.run(
            host,
            lambda: _with_backoff(
                name,
                fn,
                retries=retries,
                base=base,
                cap=cap,
                failures=local_failures,
            ),
        )
        receipt = FetchReceipt(
            source=name,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            events_fetched=len(events),
            errors=len(local_failures),
            error_sample=local_failures[0][:300] if local_failures else None,
        )
        return events, receipt, local_failures

    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="ingest-fetch") as pool:
        futures = {pool.submit(_run, name, host, fn): name for name, host, fn in tasks}
        for future in as_completed(futures):
            events, receipt, local_failures = future.result()
            sink.extend(local_failures)
            if receipts is not None:
                receipts.append(receipt)
            if events:
                out.extend(events)
    return out


def _spillover_candidates(primary: str) -> list[str]:
    """Hop-decayed BFS over the relationship graph — top peers/suppliers/customers."""
    return spillover_ids(primary, hops=2, limit=12)


def _cluster_limit() -> int:
    return _int_env("SIGNAL_CLUSTER_LIMIT", DEFAULT_SIGNAL_CLUSTER_LIMIT)


def _small_cluster_threshold() -> int:
    return _int_env("SMALL_CLUSTER_THRESHOLD", SMALL_CLUSTER_THRESHOLD)


def _pre_group_clusters(
    by_entity: dict[str, list[Event]],
) -> tuple[list[tuple[str, list[Event]]], list[list[tuple[str, list[Event]]]], int]:
    """Build proof-bearing story clusters, then split large and batched calls.

    Entity buckets are only the first partition. Within each entity, the
    existing deterministic story deduper separates unrelated developments.
    Clusters with fewer than two candidate origins remain stored as source
    events but do not become signal drafts.

    Returns ``(large_clusters, small_batches, skipped_events)`` where:
    - ``large_clusters`` = list of ``(entity_id, events)`` — one LLM call each
    - ``small_batches`` = list of batches, each a list of ``(entity_id, events)``
    """
    proof_clusters: list[tuple[str, list[Event], int, int]] = []
    skipped = 0
    for entity_id, evs in by_entity.items():
        for story in dedupe(evs):
            if story.distinct_origins < 2:
                skipped += len(story.members)
                continue
            proof_clusters.append(
                (entity_id, story.members, story.distinct_sources, story.distinct_origins)
            )
    proof_clusters.sort(key=lambda item: (item[2], item[3], len(item[1])), reverse=True)
    ranked = [(entity_id, evs) for entity_id, evs, _, _ in proof_clusters[: _cluster_limit()]]

    threshold = _small_cluster_threshold()
    large: list[tuple[str, list[Event]]] = []
    small: list[tuple[str, list[Event]]] = []
    for entity_id, evs in ranked:
        if len(evs) > threshold:
            large.append((entity_id, evs))
        else:
            small.append((entity_id, evs))

    if not small:
        return large, [], skipped

    batches = [
        small[index : index + MAX_BATCH_ENTITIES]
        for index in range(0, len(small), MAX_BATCH_ENTITIES)
    ]

    _log.info(
        "pre-group: %d proof-bearing large stories, %d small stories in %d batches; %d unproven events retained",
        len(large),
        len(small),
        len(batches),
        skipped,
    )
    return large, batches, skipped


def _event_entity(ev: Event) -> str | None:
    if ev.primary_entity_id:
        return ev.primary_entity_id
    # KEV vendor/product names are often short or generic ("Lite", "Core",
    # "Console"). Avoid broad ticker gazetteer matches; the adapter already
    # applies exact vendor/product mapping for tracked entities.
    if ev.source == "cisa-kev":
        return None
    # Attribute on title (weighted) + a tight lead window only. The full body
    # drags in "top movers" widgets, related-article rails, and doc footers that
    # inject unrelated tracked entities (see primary_entity's min-score floor).
    lead = 600 if ev.source.startswith("youtube:") else 800
    return primary_entity((ev.content or "")[:lead], title=ev.title)


def cluster_and_generate(events: list[Event]) -> list[str]:
    """Generate only from proof-bearing stories within each entity bucket."""
    by_entity: dict[str, list[Event]] = defaultdict(list)
    for ev in events:
        eid = _event_entity(ev)
        if eid:
            by_entity[eid].append(ev)

    large, batches, _ = _pre_group_clusters(by_entity)
    proof_clusters = [*large, *(cluster for batch in batches for cluster in batch)]
    written: list[str] = []
    fallback_clusters: list[tuple[str, list[Event]]] = []
    for entity_id, evs in proof_clusters:
        cand = generate(entity_id, evs, _spillover_candidates(entity_id))
        if cand:
            written.append(emit(cand))
        else:
            fallback_clusters.append((entity_id, evs))
    if not written and _fallback_drafts_enabled():
        written.extend(_emit_fallback_drafts(fallback_clusters))
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
        for theme in classify_themes(event_text(ev)):
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


def _emit_fallback_drafts(clusters: list[tuple[str, list[Event]]]) -> list[str]:
    """Emit bounded review-only fallbacks from already proof-bearing stories."""
    written: list[str] = []
    ranked = sorted(
        clusters,
        key=lambda item: (len({e.source_url for e in item[1] if e.source_url}), len(item[1])),
        reverse=True,
    )
    for entity_id, evs in ranked[:FALLBACK_DRAFT_LIMIT]:
        cand = fallback_candidate(entity_id, evs, _spillover_candidates(entity_id))
        if cand:
            written.append(emit(cand))
    return written


def _fallback_drafts_enabled() -> bool:
    """Use deterministic review drafts only when no AI reviewer is configured.

    With AI available, a model rejection or provider failure must retain the
    source events without manufacturing a lower-quality signal candidate.
    """
    return not bool(os.environ.get("AI_API_KEY") or os.environ.get("HF_TOKEN"))


def run(source: Source, days: int, *, generate_signals: bool = True) -> dict:
    started_at = datetime.now(timezone.utc)
    fetch_run_id = audit.new_run_id()
    errors = 0
    error_sample: str | None = None

    fetch_failures: list[str] = []
    fetch_receipts: list[FetchReceipt] = []
    try:
        events = fetch(source, days, failures=fetch_failures, receipts=fetch_receipts)
    except Exception as exc:
        events = []
        errors += 1
        error_sample = f"fetch: {exc}"[:300]
    if fetch_failures:
        errors += len(fetch_failures)
        if error_sample is None:
            error_sample = f"fetch: {fetch_failures[0]}"[:300]

    # Persist raw events for replay/debug regardless of downstream outcome
    events_pushed = audit.push_events(events, fetch_run_id)

    # A grouped receipt cannot distinguish a successful empty adapter from one
    # that failed. Persist one bounded receipt per adapter so the public data
    # directory can report that distinction honestly.
    if source in source_catalog.PIPELINE_SOURCE_GROUPS:
        audit.push_ingest_runs(
            [
                {
                    "source": receipt.source,
                    "startedAt": receipt.started_at.isoformat(),
                    "finishedAt": receipt.finished_at.isoformat(),
                    "days": days,
                    "eventsFetched": receipt.events_fetched,
                    "errors": receipt.errors,
                    "errorSample": receipt.error_sample,
                    "notes": f"parent_run:{fetch_run_id}",
                }
                for receipt in fetch_receipts
            ]
        )

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

    if not generate_signals:
        audit.push_ingest_run(
            source=source,
            started_at=started_at,
            days=days,
            events_fetched=len(events),
            events_dropped_no_entity=no_entity,
            events_dropped_low_cluster=0,
            signals_drafted=0,
            errors=errors,
            error_sample=error_sample,
            notes=f"fetch_run_id={fetch_run_id};mode=fetch_only",
        )
        return {
            "fetch_run_id": fetch_run_id,
            "events": len(events),
            "events_pushed": events_pushed,
            "duplicates_collapsed": duplicates_collapsed,
            "events_no_entity": no_entity,
            "events_low_cluster": 0,
            "signals_drafted": 0,
            "errors": errors,
            "paths": [],
        }

    written: list[str] = []
    fallback_clusters: list[tuple[str, list[Event]]] = []

    # Separate entity buckets into individual stories. Only stories with two
    # candidate origins reach generation; small stories share an LLM request
    # without being merged into one claim.
    large_clusters, small_batches, low_cluster = _pre_group_clusters(by_entity)

    # Large clusters: one LLM call each (high-quality, lots of evidence)
    for entity_id, evs in large_clusters:
        try:
            cand = generate(entity_id, evs, _spillover_candidates(entity_id))
        except Exception as exc:
            errors += 1
            if error_sample is None:
                error_sample = f"generate {entity_id}: {exc}"[:300]
            fallback_clusters.append((entity_id, evs))
            continue
        if cand:
            written.append(emit(cand))
        else:
            fallback_clusters.append((entity_id, evs))

    # Small stories: several independent candidates per LLM request.
    for batch in small_batches:
        clusters_with_spillover = [
            (entity_id, evs, _spillover_candidates(entity_id)) for entity_id, evs in batch
        ]
        try:
            cands = generate_batch(clusters_with_spillover)
        except Exception as exc:
            errors += 1
            if error_sample is None:
                error_sample = (
                    f"generate_batch {[e for e, _, _ in clusters_with_spillover]}: {exc}"[:300]
                )
            for entity_id, evs in batch:
                fallback_clusters.append((entity_id, evs))
            continue
        # Map candidates back by story id; repeated entity ids remain distinct.
        emitted_cluster_ids = set()
        for cand in cands:
            written.append(emit(cand))
            if cand.source_cluster_id:
                emitted_cluster_ids.add(cand.source_cluster_id)
        for index, (entity_id, evs) in enumerate(batch):
            if f"story-{index + 1}" not in emitted_cluster_ids:
                fallback_clusters.append((entity_id, evs))

    if not written and fallback_clusters and _fallback_drafts_enabled():
        fallback_written = _emit_fallback_drafts(fallback_clusters)
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
        "events_pushed": events_pushed,
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
            *sorted(source_catalog.by_id()),
            *sorted(source_catalog.PIPELINE_SOURCE_GROUPS),
        ],
        default="all",
    )
    p.add_argument("--days", type=int, default=1)
    p.add_argument(
        "--fetch-only",
        action="store_true",
        help="Persist source events and receipts without drafting signal candidates.",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit the run summary as a single JSON line (machine-readable).",
    )
    args = p.parse_args()
    out = run(args.source, args.days, generate_signals=not args.fetch_only)
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
