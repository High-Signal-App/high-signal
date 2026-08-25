"""Single source of truth for the data-source catalog.

Every ingestion source is described once here — provider, access/auth, the
fetch window (how much history we pull), what we keep, and its mapping role.
Both the human-readable catalog (`docs/operations/source-catalog.md`, regenerated via
``to_markdown``) and the data-directory generator (`data_directory.py`) read
from this list, so they never drift from the pipeline.

Storage model:
  Every event keeps source metadata, a link, and a deduplication key. Content
  depth varies by adapter: many sources keep only metadata or an excerpt, but
  generic news/SCMP/China RSS, YouTube, reviews, filings, and several structured
  APIs may retain long extracted text or a structured raw payload. The catalog's
  ``keeps`` column is therefore a field summary, not a guarantee that only those
  fields are persisted. Re-running is idempotent.
"""

from __future__ import annotations

from dataclasses import dataclass


# access: "keyless" | "free-key:<ENV>" | "paid-key:<ENV>" | "optional-key:<ENV>"
# role:   "entity" (maps to tracked entities) | "thematic" (topic/keyword)
#         | "corroboration" (official, mostly entity-less) | "numeric" (series)
# temporal: "recent" (only latest events matter) | "historical" (full history
#           has value — patents, court cases, filings) | "series" (time-series
#           where both recent prints and historical context matter — macro, rates)
@dataclass(frozen=True)
class CatalogEntry:
    id: str
    provider: str
    domains: str  # technology / startups / finance (which the brief domains it feeds)
    access: str
    official: bool  # counts toward the cite-or-kill official-source bar
    window_days: int  # default fetch window = history depth pulled per run
    role: str
    keeps: str  # the extracted fields we persist (beyond the universal link)
    temporal: str = "recent"  # recent / historical / series


DAILY_SOURCES = frozenset(
    {
        "ai-benchmarks",
        "china-news",
        "cisa-kev",
        "courtlistener",
        "dev-ecosystems",
        "edgar",
        "github",
        "gov",
        "hackernews",
        "hkex",
        "huggingface",
        "india-gov",
        "ir",
        "jobs",
        "news",
        "packages",
        "producthunt",
        "reddit",
        "scmp",
        "techmeme",
        "us-gov-rss",
    }
)
CONTEXT_SOURCES = frozenset({"crypto-onchain", "macro-rates", "markets"})
WEEKLY_SOURCES = frozenset(
    {
        "appstore",
        "appstore-reviews",
        "coingecko",
        "defillama",
        "google-trends",
        "gov-contracts",
        "legistar",
        "lobsters",
        "nvd",
        "openstates",
        "playstore-reviews",
        "regulations",
        "sec-xbrl",
        "us-gov-api",
    }
)
MONTHLY_SOURCES = frozenset({"bls", "eia", "global-macro"})
ON_DEMAND_SOURCES = frozenset({"gdelt", "semantic-scholar", "stackexchange", "substack", "youtube"})
MANUAL_SOURCES = frozenset({"companies-house", "wikidata"})
PARKED_SOURCES = frozenset(
    {
        "bluesky",
        "github-archive",
        "guardian",
        "metaculus",
        "patents",
        "podcast-index",
        "vc-portfolios",
    }
)

SOURCE_CADENCE_GROUPS = {
    "daily": DAILY_SOURCES,
    "context": CONTEXT_SOURCES,
    "weekly": WEEKLY_SOURCES,
    "monthly": MONTHLY_SOURCES,
    "on_demand": ON_DEMAND_SOURCES,
    "manual": MANUAL_SOURCES,
    "parked": PARKED_SOURCES,
}

# Named pipeline selectors. `all` intentionally means the bounded Daily Brief
# candidate set, not every adapter that happens to exist in the repository.
PIPELINE_SOURCE_GROUPS = {
    "all": DAILY_SOURCES,
    "context": CONTEXT_SOURCES,
    "weekly": WEEKLY_SOURCES,
    "monthly": MONTHLY_SOURCES,
}

_ACCESS_BASIS_OVERRIDES = {
    "github": "Public API; token recommended for production rate limits.",
    "github-archive": "Public archive; parked because transfer cost is high relative to unique yield.",
    "news": "Public RSS plus NewsAPI; NewsAPI production use requires an eligible paid plan.",
    "guardian": "Parked; developer access is non-commercial and derived commercial use requires a licence.",
    "reddit": "Public endpoints; reuse and sustained commercial access are terms-restricted.",
    "youtube": "Public discovery metadata; transcript retrieval uses an unofficial interface.",
    "appstore-reviews": "Public review feed; retained and displayed user text must be minimized.",
    "playstore-reviews": "Public review pages; retained and displayed user text must be minimized.",
    "bluesky": "Parked; authenticated social search is not unique enough to justify scheduled collection.",
    "metaculus": "Parked; authenticated forecast context overlaps the scheduled prediction-market lane.",
    "podcast-index": "Parked; authenticated episode metadata alone is not sufficient evidence.",
    "patents": "Replacement USPTO ODP API requires an account, MFA, profile, and API key.",
    "vc-portfolios": "Parked placeholder; no source fetch is implemented.",
}

_CONTENT_DEPTH_OVERRIDES = {
    "edgar": "bounded filing text (up to 50 KB)",
    "news": "metadata plus linked-page text when fetched (up to 30 KB)",
    "scmp": "RSS metadata plus linked-page text when fetched (up to 30 KB)",
    "china-news": "RSS metadata plus linked-page text when fetched (up to 30 KB)",
    "youtube": "metadata plus transcript when available (up to 30 KB)",
    "appstore-reviews": "bounded user review text (up to 20 KB)",
    "playstore-reviews": "bounded user review text (up to 20 KB)",
    "packages": "metadata plus selected structured payload",
    "sec-xbrl": "structured payload",
    "gov-contracts": "metadata plus selected structured payload",
    "podcast-index": "metadata plus selected structured payload",
}

_TERMS_RISK_OVERRIDES = {
    "guardian": "restricted",
    "news": "restricted",
    "reddit": "restricted",
    "youtube": "unofficial-transcript",
    "appstore-reviews": "user-content",
    "playstore-reviews": "user-content",
    "patents": "credential-gated",
}


def _cadence(entry: CatalogEntry) -> str:
    for cadence, source_ids in SOURCE_CADENCE_GROUPS.items():
        if entry.id in source_ids:
            return cadence
    raise ValueError(f"source {entry.id!r} has no operational cadence")


def expected_run_cadence_hours(entry: CatalogEntry) -> int | None:
    cadence = _cadence(entry)
    if entry.id == "markets":
        return 4
    if cadence in {"daily", "context"}:
        return 24
    if cadence == "weekly":
        return 24 * 7
    if cadence == "monthly":
        return 24 * 30
    return None


def source_ids_for_selector(selector: str) -> frozenset[str]:
    grouped = PIPELINE_SOURCE_GROUPS.get(selector)
    if grouped is not None:
        return grouped
    return frozenset({selector})


def _access_basis(entry: CatalogEntry) -> str:
    override = _ACCESS_BASIS_OVERRIDES.get(entry.id)
    if override:
        return override
    if entry.access == "keyless":
        return "Public endpoint; no project credential required."
    if entry.access.startswith("free-key:"):
        return "Free registration key required; adapter yields nothing when absent."
    if entry.access.startswith("optional-key:"):
        return "Optional credential enables this adapter or additional depth."
    if entry.access.startswith("parked:"):
        return "Credential-gated and excluded from scheduled ingestion."
    return "Access basis not yet reviewed."


def _content_depth(entry: CatalogEntry) -> str:
    return _CONTENT_DEPTH_OVERRIDES.get(entry.id, "metadata or bounded excerpt")


def _retention(entry: CatalogEntry) -> str:
    if entry.id in _CONTENT_DEPTH_OVERRIDES:
        return "D1 event history; source document retained when the adapter emits one."
    return "D1 event history with canonical source link and deduplication metadata."


CATALOG: list[CatalogEntry] = [
    # --- Capital & filings -------------------------------------------------
    CatalogEntry(
        "edgar",
        "SEC EDGAR",
        "finance",
        "keyless",
        True,
        1,
        "entity",
        "form type, filing date, items",
        "historical",
    ),
    CatalogEntry(
        "sec-xbrl",
        "SEC XBRL frames",
        "finance",
        "keyless",
        True,
        120,
        "entity",
        "fundamental metric + value",
        "series",
    ),
    CatalogEntry(
        "hkex",
        "HKEXnews",
        "finance",
        "keyless",
        True,
        3,
        "entity",
        "filing title, issuer",
        "historical",
    ),
    CatalogEntry(
        "ir",
        "Investor-relations pages",
        "finance",
        "keyless",
        True,
        1,
        "entity",
        "headline, IR url",
        "recent",
    ),
    CatalogEntry(
        "companies-house",
        "UK Companies House",
        "startups",
        "free-key:COMPANIES_HOUSE_API_KEY",
        True,
        1,
        "entity",
        "filing type, company",
        "historical",
    ),
    # --- Builder / dev -----------------------------------------------------
    CatalogEntry(
        "github",
        "GitHub API",
        "technology",
        "keyless",
        False,
        7,
        "entity",
        "repo, release, stars delta",
        "recent",
    ),
    CatalogEntry(
        "github-archive",
        "GH Archive",
        "technology",
        "keyless",
        False,
        1,
        "thematic",
        "event type, repo",
        "recent",
    ),
    CatalogEntry(
        "huggingface",
        "Hugging Face Hub",
        "technology",
        "keyless",
        False,
        7,
        "entity",
        "model/dataset, downloads",
        "recent",
    ),
    CatalogEntry(
        "packages",
        "npm / PyPI / Rust / Java / Ruby / PHP + OSV",
        "technology",
        "keyless",
        False,
        7,
        "thematic",
        "package, version, advisory",
        "recent",
    ),
    CatalogEntry(
        "patents",
        "USPTO PatentsView (legacy probe; parked)",
        "technology",
        "parked:USPTO_ODP_API_KEY",
        False,
        365,
        "entity",
        "patent title, assignee",
        "historical",
    ),
    # --- Research ----------------------------------------------------------
    CatalogEntry(
        "semantic-scholar",
        "Semantic Scholar",
        "technology",
        "keyless",
        False,
        30,
        "thematic",
        "paper title, abstract snippet",
        "historical",
    ),
    # --- Discourse / community --------------------------------------------
    CatalogEntry(
        "reddit",
        "Reddit",
        "startups",
        "keyless",
        False,
        1,
        "thematic",
        "post title, subreddit, score",
        "recent",
    ),
    CatalogEntry(
        "hackernews",
        "HN (Algolia)",
        "technology",
        "keyless",
        False,
        7,
        "thematic",
        "title, points, comments, link",
        "recent",
    ),
    CatalogEntry(
        "stackexchange",
        "Stack Overflow",
        "technology",
        "keyless",
        False,
        30,
        "thematic",
        "question, tags, score",
        "historical",
    ),
    CatalogEntry(
        "producthunt",
        "Product Hunt (RSS)",
        "startups",
        "keyless",
        False,
        7,
        "thematic",
        "product name, tagline, link",
        "recent",
    ),
    CatalogEntry(
        "vc-portfolios",
        "YC, Antler, a16z, and Techstars official directories (parked placeholder)",
        "startups",
        "keyless",
        True,
        30,
        "thematic",
        "company name, description, cohort/program, first-party evidence, inferred competitors",
        "historical",
    ),
    CatalogEntry(
        "google-trends",
        "Google Trends (RSS)",
        "startups",
        "keyless",
        False,
        2,
        "thematic",
        "trending search term, approx traffic",
        "recent",
    ),
    CatalogEntry(
        "appstore",
        "Apple App Store charts",
        "startups",
        "keyless",
        False,
        1,
        "thematic",
        "app name, developer, chart rank",
        "recent",
    ),
    CatalogEntry(
        "appstore-reviews",
        "App Store reviews (iTunes RSS)",
        "startups",
        "keyless",
        False,
        14,
        "thematic",
        "review rating, title, text",
        "recent",
    ),
    CatalogEntry(
        "playstore-reviews",
        "Google Play reviews",
        "startups",
        "keyless",
        False,
        14,
        "thematic",
        "review rating, text",
        "recent",
    ),
    CatalogEntry(
        "lobsters",
        "Lobste.rs",
        "technology",
        "keyless",
        False,
        3,
        "thematic",
        "story title, tags",
        "recent",
    ),
    CatalogEntry(
        "bluesky",
        "Bluesky",
        "technology",
        "optional-key:BLUESKY_*",
        False,
        7,
        "thematic",
        "post text, author",
        "recent",
    ),
    CatalogEntry(
        "youtube",
        "YouTube discovery + transcripts",
        "technology",
        "optional-key:YOUTUBE_API_KEY",
        False,
        7,
        "thematic",
        "video title, view count, channel, transcript snippet when available",
        "recent",
    ),
    CatalogEntry(
        "substack",
        "Substack RSS",
        "technology",
        "keyless",
        False,
        7,
        "thematic",
        "post title, summary",
        "recent",
    ),
    CatalogEntry(
        "techmeme", "Techmeme", "technology", "keyless", False, 3, "thematic", "headline", "recent"
    ),
    CatalogEntry(
        "podcast-index",
        "Podcast Index",
        "technology",
        "optional-key:PODCAST_INDEX_*",
        False,
        14,
        "thematic",
        "episode title, summary",
        "recent",
    ),
    # --- News --------------------------------------------------------------
    CatalogEntry(
        "news",
        "NewsAPI + RSS",
        "technology",
        "free-key:NEWSAPI_KEY",
        False,
        1,
        "entity",
        "headline, source, snippet",
        "recent",
    ),
    CatalogEntry(
        "guardian",
        "The Guardian",
        "technology",
        "free-key:GUARDIAN_API_KEY",
        False,
        7,
        "thematic",
        "headline, section",
        "recent",
    ),
    CatalogEntry(
        "scmp",
        "South China Morning Post",
        "technology / finance",
        "keyless",
        False,
        3,
        "thematic",
        "China tech/economy headline, link",
        "recent",
    ),
    CatalogEntry(
        "china-news",
        "TechNode / Pandaily / CGTN",
        "technology / startups / finance",
        "keyless",
        False,
        3,
        "thematic",
        "China tech/startup/business headline, link",
        "recent",
    ),
    CatalogEntry(
        "gdelt",
        "GDELT",
        "finance",
        "keyless",
        False,
        1,
        "thematic",
        "event, tone, mentions",
        "recent",
    ),
    # --- Policy & government ----------------------------------------------
    CatalogEntry(
        "gov",
        "Federal Register + agency RSS",
        "finance",
        "keyless",
        True,
        3,
        "thematic",
        "rule/notice title, agency",
        "historical",
    ),
    CatalogEntry(
        "gov-contracts",
        "SAM / SBIR / USAspending",
        "startups",
        "optional-key:SAM_API_KEY",
        True,
        30,
        "corroboration",
        "award/solicitation title, agency",
        "historical",
    ),
    CatalogEntry(
        "regulations",
        "Regulations.gov",
        "finance",
        "free-key:REGULATIONS_GOV_API_KEY",
        True,
        30,
        "corroboration",
        "docket, comment window",
        "historical",
    ),
    CatalogEntry(
        "legistar",
        "Legistar/Granicus (municipal)",
        "finance",
        "keyless",
        True,
        30,
        "corroboration",
        "matter title, body, file no.",
        "historical",
    ),
    CatalogEntry(
        "openstates",
        "OpenStates (state bills)",
        "finance",
        "free-key:OPENSTATES_API_KEY",
        True,
        30,
        "corroboration",
        "bill id, title, latest action",
        "historical",
    ),
    CatalogEntry(
        "courtlistener",
        "CourtListener (litigation)",
        "finance",
        "keyless",
        True,
        30,
        "corroboration",
        "case name, court, nature of suit",
        "historical",
    ),
    # --- Markets / forecasting --------------------------------------------
    CatalogEntry(
        "markets",
        "Polymarket/Manifold/Kalshi",
        "finance",
        "keyless",
        False,
        30,
        "thematic",
        "question, probability (quote)",
        "recent",
    ),
    CatalogEntry(
        "metaculus",
        "Metaculus",
        "finance",
        "optional-key:METACULUS_TOKEN",
        False,
        30,
        "thematic",
        "question, community forecast",
        "recent",
    ),
    CatalogEntry(
        "coingecko",
        "CoinGecko",
        "finance",
        "keyless",
        False,
        1,
        "thematic",
        "trending coin / 24h mover, rank, price",
        "recent",
    ),
    CatalogEntry(
        "defillama",
        "DeFiLlama",
        "finance",
        "keyless",
        False,
        1,
        "thematic",
        "protocol TVL + 1d move, category",
        "recent",
    ),
    CatalogEntry(
        "bls",
        "BLS economic data",
        "finance",
        "optional-key:BLS_API_KEY",
        True,
        120,
        "numeric",
        "CPI / unemployment / payrolls latest print",
        "series",
    ),
    # --- Macro / energy / reference ---------------------------------------
    CatalogEntry(
        "macro-rates",
        "ECB FX + FRED",
        "finance",
        "optional-key:FRED_API_KEY",
        False,
        30,
        "numeric",
        "series id, observation value",
        "series",
    ),
    CatalogEntry(
        "eia",
        "EIA energy",
        "finance",
        "free-key:EIA_API_KEY",
        True,
        120,
        "numeric",
        "state, period, electricity price",
        "series",
    ),
    CatalogEntry(
        "wikidata",
        "Wikidata",
        "technology",
        "keyless",
        False,
        1,
        "entity",
        "entity enrichment fields",
        "recent",
    ),
    # --- Security ----------------------------------------------------------
    CatalogEntry(
        "nvd",
        "NVD (CVE)",
        "technology",
        "keyless",
        False,
        14,
        "thematic",
        "CVE id, CVSS, summary",
        "historical",
    ),
    CatalogEntry(
        "cisa-kev",
        "CISA KEV",
        "technology",
        "keyless",
        True,
        7,
        "thematic",
        "CVE id, vendor, due date",
        "recent",
    ),
    # --- Jobs --------------------------------------------------------------
    CatalogEntry(
        "jobs",
        "Greenhouse/Lever/Ashby",
        "startups",
        "keyless",
        False,
        14,
        "entity",
        "role, company, location",
        "recent",
    ),
    # --- US government RSS (enforcement / press / halts) -------------------
    CatalogEntry(
        "us-gov-rss",
        "SEC litigation / FTC / DOJ / CFTC / GAO / Nasdaq halts",
        "finance",
        "keyless",
        True,
        7,
        "corroboration",
        "release title, agency, halt symbol",
        "historical",
    ),
    # --- US government APIs (macro / legislative / research) ---------------
    CatalogEntry(
        "us-gov-api",
        "CFTC COT / Treasury / BEA / Census / Congress / FEC / LDA / CFPB / FDA / NIH / NSF / USGS / NOAA / USDA",
        "finance",
        "optional-key:BEA_API_KEY,CENSUS_API_KEY,CONGRESS_API_KEY,FEC_API_KEY,LDA_API_KEY,FDA_API_KEY,USDA_NASS_API_KEY",
        True,
        30,
        "numeric",
        "indicator, value, period; bills, votes, grants, complaints",
        "series",
    ),
    # --- India government / regulators -------------------------------------
    CatalogEntry(
        "india-gov",
        "SEBI / RBI / MOSPI / BSE / NSE / AMFI / NPCI / data.gov.in",
        "finance",
        "optional-key:DATA_GOV_IN_API_KEY",
        True,
        3,
        "entity",
        "circular, filing, CPI/IIP, NAV, UPI volume",
        "series",
    ),
    # --- Global macro (IMF / World Bank / BIS / UN Comtrade) ---------------
    CatalogEntry(
        "global-macro",
        "IMF / World Bank / BIS / UN Comtrade",
        "finance",
        "keyless",
        True,
        30,
        "numeric",
        "GDP, CPI, trade, exchange rate, policy rate",
        "series",
    ),
    # --- Crypto on-chain (beyond CoinGecko / DeFiLlama) --------------------
    CatalogEntry(
        "crypto-onchain",
        "mempool.space / L2Beat / CoinMetrics / Etherscan / Token Unlocks",
        "finance",
        "optional-key:ETHERSCAN_API_KEY,TOKEN_UNLOCKS_API_KEY",
        False,
        1,
        "numeric",
        "fees, TVL+stage, active addresses, gas, unlock schedule",
        "series",
    ),
    # --- AI benchmarks ------------------------------------------------------
    CatalogEntry(
        "ai-benchmarks",
        "LMSYS Arena / Artificial Analysis / OpenRouter",
        "technology",
        "optional-key:ARTIFICIAL_ANALYSIS_API_KEY,OPENROUTER_API_KEY",
        False,
        1,
        "thematic",
        "model name, ELO, intelligence index, token usage rank",
        "series",
    ),
    # --- Developer ecosystems (beyond GitHub / npm / PyPI) ------------------
    CatalogEntry(
        "dev-ecosystems",
        "Papers with Code / GitLab / Docker Hub / dev.to / libraries.io / Replicate",
        "technology",
        "optional-key:LIBRARIES_IO_API_KEY,REPLICATE_API_TOKEN",
        False,
        7,
        "thematic",
        "paper, repo, image, article, package, model",
        "recent",
    ),
]


def by_id() -> dict[str, CatalogEntry]:
    return {e.id: e for e in CATALOG}


_ROLE_NOTE = {
    "entity": "maps to a tracked company",
    "thematic": "topic/keyword (entity-less)",
    "corroboration": "official 2nd-source, mostly entity-less",
    "numeric": "time-series values",
}

_TEMPORAL_NOTE = {
    "recent": "only the latest events matter — stale after days",
    "historical": "full history has value — patents, filings, court cases",
    "series": "time-series — both recent prints and historical trends matter",
}


def to_markdown() -> str:
    """Render the full catalog as the `docs/operations/source-catalog.md` table."""
    lines = [
        "# Data-source catalog",
        "",
        "> Generated from `python/ingest/src/high_signal_ingest/source_catalog.py`.",
        "> Regenerate: `uv run python -m high_signal_ingest.source_catalog > ../../docs/operations/source-catalog.md`",
        "",
        "## Storage model",
        "",
        "Every event keeps source metadata, a link, and a deduplication key. "
        "Content depth varies by adapter:",
        "",
        "- `source`, `source_url` (**the link**), `published_at`",
        "- `title` plus adapter-specific `content`; most adapters cap it at 20 KB",
        "- `raw_hash` / `document_key` for idempotent dedup, `primary_entity_id` when matched",
        "- structured `raw_json` for selected APIs and documents",
        "",
        "Generic news, SCMP, and broader China-news RSS currently fetch linked "
        "article pages and may keep up to 30 KB of extracted text. YouTube may keep "
        "up to 30 KB of transcript, EDGAR filings up to 50 KB, and review adapters "
        "may keep review text. These are not metadata-only integrations.",
        "",
        "Persisted records live in **Cloudflare D1** (events/signals/evidence/source "
        "documents) plus git-versioned `signals/*.md`. The source audit records the "
        "access, retention, and terms risks that this compact catalog cannot express.",
        "",
        "Digg is a deliberate rolling-feed exception: because Digg exposes "
        "rolling windows without a historical archive, High Signal retains its documented "
        "feed payloads and per-cluster snapshots in dedicated `digg_*` tables. Those rows "
        "are derived attention metadata, never event evidence.",
        "",
        "## History / retention",
        "",
        "**History depth** below = the default fetch window per run (how far back "
        "each daily run pulls). Wider one-off backfills pass a larger `--days`. "
        "Dedup is by `document_key`, so re-runs over the same window don't duplicate. "
        "No automatic D1 pruning today — events accumulate; the signal store is "
        "append-only by design.",
        "",
        "## Sources",
        "",
        f"**{len(CATALOG)} sources.** Access: `keyless` = no auth; `free-key` = free "
        "registration (skipped without the env var, ingest stays green); "
        "`optional-key` = works degraded/empty without it. ⚖️ = counts toward the "
        "cite-or-kill official-source bar. **Temporal:** `recent` = only latest "
        "events matter; `historical` = full archive has value; `series` = "
        "time-series where both recent prints and historical trends matter.",
        "**Cadence:** `daily` = included in the bounded `pipeline --source all` Daily Brief "
        "candidate run; `context` = separately refreshed calibration data; `weekly` / "
        "`monthly` = slower scheduled collection; `on_demand` / `manual` = explicit use only; "
        "`parked` = excluded from scheduled ingestion. Cadence describes execution policy, "
        "not whether an adapter produced rows.",
        "",
        "| Source | Provider | Domain | Access | Cadence | ⚖️ | History | Role | Temporal | Content depth | Retention | Terms risk | Extracted fields kept |",
        "|---|---|---|---|---|:--:|--:|---|---|---|---|---|---|",
    ]
    for e in sorted(CATALOG, key=lambda x: (x.role, x.id)):
        official = "⚖️" if e.official else ""
        role = f"{e.role}"
        lines.append(
            f"| `{e.id}` | {e.provider} | {e.domains} | {e.access} | {_cadence(e)} | {official} "
            f"| {e.window_days}d | {role} | {e.temporal} | {_content_depth(e)} "
            f"| {_retention(e)} | {_TERMS_RISK_OVERRIDES.get(e.id, 'not-reviewed')} | {e.keeps} |"
        )
    lines += [
        "",
        "**Role key:** " + " · ".join(f"*{k}* = {v}" for k, v in _ROLE_NOTE.items()) + ".",
        "",
        "**Temporal key:** " + " · ".join(f"*{k}* = {v}" for k, v in _TEMPORAL_NOTE.items()) + ".",
        "",
        "## Derived attention overlays",
        "",
        "- **Digg technology clusters** — five documented public JSON/YAML feeds, polled "
        "every 30 minutes with a server-enforced 10-minute minimum refresh interval. "
        "Stored as normalized current clusters plus append-only snapshots. Classification: "
        "`source_class=attention_aggregator`, `evidence_tier=derived`, "
        "`confidence_contribution=none`, `attention_contribution=allowed`. Digg can change "
        "discovery and brief prominence but cannot satisfy cite-or-kill or raise confidence.",
        "",
        "View the actual available data per source with the **data directory**: "
        "`uv run python -m high_signal_ingest.data_directory` → writes "
        "`data-directory/INDEX.md` + one JSON file of recent samples per source.",
        "",
    ]
    return "\n".join(lines)


def to_dicts() -> list[dict[str, object]]:
    """Catalog as plain dicts — consumed by the web data-explore page (JSON)."""
    return [
        {
            "id": e.id,
            "provider": e.provider,
            "domains": e.domains,
            "access": e.access,
            "official": e.official,
            "windowDays": e.window_days,
            "role": e.role,
            "keeps": e.keeps,
            "temporal": e.temporal,
            "cadence": _cadence(e),
            "expectedRunCadenceHours": expected_run_cadence_hours(e),
            "accessBasis": _access_basis(e),
            "contentDepth": _content_depth(e),
            "retention": _retention(e),
            "termsRisk": _TERMS_RISK_OVERRIDES.get(e.id, "not-reviewed"),
        }
        for e in sorted(CATALOG, key=lambda x: (x.role, x.id))
    ]


def main() -> None:
    import json
    import sys

    if "--json" in sys.argv[1:]:
        print(json.dumps({"sources": to_dicts(), "count": len(CATALOG)}, indent=2))
    else:
        print(to_markdown())


if __name__ == "__main__":
    main()
