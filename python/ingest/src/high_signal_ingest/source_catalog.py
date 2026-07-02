"""Single source of truth for the data-source catalog.

Every ingestion source is described once here — provider, access/auth, the
fetch window (how much history we pull), what we keep, and its mapping role.
Both the human-readable catalog (`docs/source-catalog.md`, regenerated via
``to_markdown``) and the data-directory generator (`data_directory.py`) read
from this list, so they never drift from the pipeline.

Storage model (applies to every source):
  We **extract info and keep the link** — we do NOT store raw payloads
  (HTML/PDF/JSON/full article or opinion text) that are one query away from the
  source. Each event persists: ``source``, ``source_url`` (the link),
  ``published_at``, a short ``title``, an extracted ``content`` summary (hard
  cap 20 KB, typically <2 KB), ``raw_hash``/``document_key`` for dedup, and
  ``primary_entity_id`` when one is matched. Re-running is idempotent.
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
    domains: str            # technology / startups / finance (which the brief domains it feeds)
    access: str
    official: bool          # counts toward the cite-or-kill official-source bar
    window_days: int        # default fetch window = history depth pulled per run
    role: str
    keeps: str              # the extracted fields we persist (beyond the universal link)
    temporal: str = "recent"  # recent / historical / series


CATALOG: list[CatalogEntry] = [
    # --- Capital & filings -------------------------------------------------
    CatalogEntry("edgar", "SEC EDGAR", "finance", "keyless", True, 1, "entity", "form type, filing date, items", "historical"),
    CatalogEntry("sec-xbrl", "SEC XBRL frames", "finance", "keyless", True, 120, "entity", "fundamental metric + value", "series"),
    CatalogEntry("hkex", "HKEXnews", "finance", "keyless", True, 3, "entity", "filing title, issuer", "historical"),
    CatalogEntry("ir", "Investor-relations pages", "finance", "keyless", True, 1, "entity", "headline, IR url", "recent"),
    CatalogEntry("companies-house", "UK Companies House", "startups", "free-key:COMPANIES_HOUSE_API_KEY", True, 1, "entity", "filing type, company", "historical"),
    # --- Builder / dev -----------------------------------------------------
    CatalogEntry("github", "GitHub API", "technology", "keyless", False, 7, "entity", "repo, release, stars delta", "recent"),
    CatalogEntry("github-archive", "GH Archive", "technology", "keyless", False, 1, "thematic", "event type, repo", "recent"),
    CatalogEntry("huggingface", "Hugging Face Hub", "technology", "keyless", False, 7, "entity", "model/dataset, downloads", "recent"),
    CatalogEntry("packages", "npm / PyPI / Rust / Java / Ruby / PHP + OSV", "technology", "keyless", False, 7, "thematic", "package, version, advisory", "recent"),
    CatalogEntry("patents", "USPTO PatentsView", "technology", "keyless", False, 365, "entity", "patent title, assignee", "historical"),
    # --- Research ----------------------------------------------------------
    CatalogEntry("semantic-scholar", "Semantic Scholar", "technology", "keyless", False, 30, "thematic", "paper title, abstract snippet", "historical"),
    # --- Discourse / community --------------------------------------------
    CatalogEntry("reddit", "Reddit", "startups", "keyless", False, 1, "thematic", "post title, subreddit, score", "recent"),
    CatalogEntry("hackernews", "HN (Algolia)", "technology", "keyless", False, 7, "thematic", "title, points, comments, link", "recent"),
    CatalogEntry("stackexchange", "Stack Overflow", "technology", "keyless", False, 30, "thematic", "question, tags, score", "historical"),
    CatalogEntry("producthunt", "Product Hunt (RSS)", "startups", "keyless", False, 7, "thematic", "product name, tagline, link", "recent"),
    CatalogEntry("google-trends", "Google Trends (RSS)", "startups", "keyless", False, 2, "thematic", "trending search term, approx traffic", "recent"),
    CatalogEntry("appstore", "Apple App Store charts", "startups", "keyless", False, 1, "thematic", "app name, developer, chart rank", "recent"),
    CatalogEntry("appstore-reviews", "App Store reviews (iTunes RSS)", "startups", "keyless", False, 14, "thematic", "review rating, title, text", "recent"),
    CatalogEntry("playstore-reviews", "Google Play reviews", "startups", "keyless", False, 14, "thematic", "review rating, text", "recent"),
    CatalogEntry("lobsters", "Lobste.rs", "technology", "keyless", False, 3, "thematic", "story title, tags", "recent"),
    CatalogEntry("bluesky", "Bluesky", "technology", "optional-key:BLUESKY_*", False, 7, "thematic", "post text, author", "recent"),
    CatalogEntry("youtube", "YouTube transcripts", "technology", "optional-key:YOUTUBE_API_KEY", False, 7, "thematic", "video title, transcript snippet", "recent"),
    CatalogEntry("substack", "Substack RSS", "technology", "keyless", False, 7, "thematic", "post title, summary", "recent"),
    CatalogEntry("techmeme", "Techmeme", "technology", "keyless", False, 3, "thematic", "headline", "recent"),
    CatalogEntry("podcast-index", "Podcast Index", "technology", "optional-key:PODCAST_INDEX_*", False, 14, "thematic", "episode title, summary", "recent"),
    # --- News --------------------------------------------------------------
    CatalogEntry("news", "NewsAPI + RSS", "technology", "free-key:NEWSAPI_KEY", False, 1, "entity", "headline, source, snippet", "recent"),
    CatalogEntry("guardian", "The Guardian", "technology", "free-key:GUARDIAN_API_KEY", False, 7, "thematic", "headline, section", "recent"),
    CatalogEntry("scmp", "South China Morning Post", "technology / finance", "keyless", False, 3, "thematic", "China tech/economy headline, link", "recent"),
    CatalogEntry("china-news", "TechNode / Pandaily / CGTN", "technology / startups / finance", "keyless", False, 3, "thematic", "China tech/startup/business headline, link", "recent"),
    CatalogEntry("gdelt", "GDELT", "finance", "keyless", False, 1, "thematic", "event, tone, mentions", "recent"),
    # --- Policy & government ----------------------------------------------
    CatalogEntry("gov", "Federal Register + agency RSS", "finance", "keyless", True, 3, "thematic", "rule/notice title, agency", "historical"),
    CatalogEntry("gov-contracts", "SAM / SBIR / USAspending", "startups", "optional-key:SAM_API_KEY", True, 30, "corroboration", "award/solicitation title, agency", "historical"),
    CatalogEntry("regulations", "Regulations.gov", "finance", "free-key:REGULATIONS_GOV_API_KEY", True, 30, "corroboration", "docket, comment window", "historical"),
    CatalogEntry("legistar", "Legistar/Granicus (municipal)", "finance", "keyless", True, 30, "corroboration", "matter title, body, file no.", "historical"),
    CatalogEntry("openstates", "OpenStates (state bills)", "finance", "free-key:OPENSTATES_API_KEY", True, 30, "corroboration", "bill id, title, latest action", "historical"),
    CatalogEntry("courtlistener", "CourtListener (litigation)", "finance", "keyless", True, 30, "corroboration", "case name, court, nature of suit", "historical"),
    # --- Markets / forecasting --------------------------------------------
    CatalogEntry("markets", "Polymarket/Manifold/Kalshi", "finance", "keyless", False, 30, "thematic", "question, probability (quote)", "recent"),
    CatalogEntry("metaculus", "Metaculus", "finance", "optional-key:METACULUS_TOKEN", False, 30, "thematic", "question, community forecast", "recent"),
    CatalogEntry("coingecko", "CoinGecko", "finance", "keyless", False, 1, "thematic", "trending coin / 24h mover, rank, price", "recent"),
    CatalogEntry("defillama", "DeFiLlama", "finance", "keyless", False, 1, "thematic", "protocol TVL + 1d move, category", "recent"),
    CatalogEntry("bls", "BLS economic data", "finance", "optional-key:BLS_API_KEY", True, 120, "numeric", "CPI / unemployment / payrolls latest print", "series"),
    # --- Macro / energy / reference ---------------------------------------
    CatalogEntry("macro-rates", "ECB FX + FRED", "finance", "optional-key:FRED_API_KEY", False, 30, "numeric", "series id, observation value", "series"),
    CatalogEntry("eia", "EIA energy", "finance", "free-key:EIA_API_KEY", True, 120, "numeric", "state, period, electricity price", "series"),
    CatalogEntry("wikidata", "Wikidata", "technology", "keyless", False, 1, "entity", "entity enrichment fields", "recent"),
    # --- Security ----------------------------------------------------------
    CatalogEntry("nvd", "NVD (CVE)", "technology", "keyless", False, 14, "thematic", "CVE id, CVSS, summary", "historical"),
    CatalogEntry("cisa-kev", "CISA KEV", "technology", "keyless", True, 7, "thematic", "CVE id, vendor, due date", "recent"),
    # --- Jobs --------------------------------------------------------------
    CatalogEntry("jobs", "Greenhouse/Lever/Ashby", "startups", "keyless", False, 14, "entity", "role, company, location", "recent"),
    # --- US government RSS (enforcement / press / halts) -------------------
    CatalogEntry("us-gov-rss", "SEC litigation / FTC / DOJ / CFTC / GAO / Nasdaq halts", "finance", "keyless", True, 7, "corroboration", "release title, agency, halt symbol", "historical"),
    # --- US government APIs (macro / legislative / research) ---------------
    CatalogEntry("us-gov-api", "CFTC COT / Treasury / BEA / Census / Congress / FEC / LDA / CFPB / FDA / NIH / NSF / USGS / NOAA / USDA", "finance", "optional-key:BEA_API_KEY,CENSUS_API_KEY,CONGRESS_API_KEY,FEC_API_KEY,LDA_API_KEY,FDA_API_KEY,USDA_NASS_API_KEY", True, 30, "numeric", "indicator, value, period; bills, votes, grants, complaints", "series"),
    # --- India government / regulators -------------------------------------
    CatalogEntry("india-gov", "SEBI / RBI / MOSPI / BSE / NSE / AMFI / NPCI / data.gov.in", "finance", "optional-key:DATA_GOV_IN_API_KEY", True, 3, "entity", "circular, filing, CPI/IIP, NAV, UPI volume", "series"),
    # --- Global macro (IMF / World Bank / BIS / UN Comtrade) ---------------
    CatalogEntry("global-macro", "IMF / World Bank / BIS / UN Comtrade", "finance", "keyless", True, 30, "numeric", "GDP, CPI, trade, exchange rate, policy rate", "series"),
    # --- Crypto on-chain (beyond CoinGecko / DeFiLlama) --------------------
    CatalogEntry("crypto-onchain", "mempool.space / L2Beat / CoinMetrics / Etherscan / Token Unlocks", "finance", "optional-key:ETHERSCAN_API_KEY,TOKEN_UNLOCKS_API_KEY", False, 1, "numeric", "fees, TVL+stage, active addresses, gas, unlock schedule", "series"),
    # --- AI benchmarks ------------------------------------------------------
    CatalogEntry("ai-benchmarks", "LMSYS Arena / Artificial Analysis / OpenRouter", "technology", "optional-key:ARTIFICIAL_ANALYSIS_API_KEY,OPENROUTER_API_KEY", False, 1, "thematic", "model name, ELO, intelligence index, token usage rank", "series"),
    # --- Developer ecosystems (beyond GitHub / npm / PyPI) ------------------
    CatalogEntry("dev-ecosystems", "Papers with Code / GitLab / Docker Hub / dev.to / libraries.io / Replicate", "technology", "optional-key:LIBRARIES_IO_API_KEY,REPLICATE_API_TOKEN", False, 7, "thematic", "paper, repo, image, article, package, model", "recent"),
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
    """Render the full catalog as the `docs/source-catalog.md` table."""
    lines = [
        "# Data-source catalog",
        "",
        "> Generated from `python/ingest/src/high_signal_ingest/source_catalog.py`.",
        "> Regenerate: `uv run python -m high_signal_ingest.source_catalog > ../../docs/source-catalog.md`",
        "",
        "## Storage model",
        "",
        "**We extract info and keep the link** — we do *not* store raw payloads "
        "(HTML / PDF / JSON / full article or opinion text) that are one query away "
        "from the source. Each event persists only:",
        "",
        "- `source`, `source_url` (**the link**), `published_at`",
        "- a short `title` + an extracted `content` summary (hard cap **20 KB**, "
        "typically <2 KB)",
        "- `raw_hash` / `document_key` for idempotent dedup, `primary_entity_id` when matched",
        "",
        "Persisted in **Cloudflare D1** (events/signals/evidence) + git-versioned "
        "`signals/*.md`. Footprint is **KB/day of new signals, low-MB total** — the "
        "cost center is LLM tokens, not storage.",
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
        "",
        "| Source | Provider | Domain | Access | ⚖️ | History | Role | Temporal | Extracted fields kept |",
        "|---|---|---|---|:--:|--:|---|---|---|",
    ]
    for e in sorted(CATALOG, key=lambda x: (x.role, x.id)):
        official = "⚖️" if e.official else ""
        role = f"{e.role}"
        lines.append(
            f"| `{e.id}` | {e.provider} | {e.domains} | {e.access} | {official} "
            f"| {e.window_days}d | {role} | {e.temporal} | {e.keeps} |"
        )
    lines += [
        "",
        "**Role key:** "
        + " · ".join(f"*{k}* = {v}" for k, v in _ROLE_NOTE.items())
        + ".",
        "",
        "**Temporal key:** "
        + " · ".join(f"*{k}* = {v}" for k, v in _TEMPORAL_NOTE.items())
        + ".",
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
