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


CATALOG: list[CatalogEntry] = [
    # --- Capital & filings -------------------------------------------------
    CatalogEntry("edgar", "SEC EDGAR", "finance", "keyless", True, 1, "entity", "form type, filing date, items"),
    CatalogEntry("sec-xbrl", "SEC XBRL frames", "finance", "keyless", True, 120, "entity", "fundamental metric + value"),
    CatalogEntry("hkex", "HKEXnews", "finance", "keyless", True, 3, "entity", "filing title, issuer"),
    CatalogEntry("ir", "Investor-relations pages", "finance", "keyless", True, 1, "entity", "headline, IR url"),
    CatalogEntry("companies-house", "UK Companies House", "startups", "free-key:COMPANIES_HOUSE_API_KEY", True, 1, "entity", "filing type, company"),
    # --- Builder / dev -----------------------------------------------------
    CatalogEntry("github", "GitHub API", "technology", "keyless", False, 7, "entity", "repo, release, stars delta"),
    CatalogEntry("github-archive", "GH Archive", "technology", "keyless", False, 1, "thematic", "event type, repo"),
    CatalogEntry("huggingface", "Hugging Face Hub", "technology", "keyless", False, 7, "entity", "model/dataset, downloads"),
    CatalogEntry("packages", "npm / PyPI + OSV", "technology", "keyless", False, 7, "thematic", "package, version, advisory"),
    CatalogEntry("patents", "USPTO PatentsView", "technology", "keyless", False, 365, "entity", "patent title, assignee"),
    # --- Research ----------------------------------------------------------
    CatalogEntry("semantic-scholar", "Semantic Scholar", "technology", "keyless", False, 30, "thematic", "paper title, abstract snippet"),
    # --- Discourse / community --------------------------------------------
    CatalogEntry("reddit", "Reddit", "startups", "keyless", False, 1, "thematic", "post title, subreddit, score"),
    CatalogEntry("hackernews", "HN (Algolia)", "technology", "keyless", False, 7, "thematic", "title, points, comments, link"),
    CatalogEntry("stackexchange", "Stack Overflow", "technology", "keyless", False, 30, "thematic", "question, tags, score"),
    CatalogEntry("lobsters", "Lobste.rs", "technology", "keyless", False, 3, "thematic", "story title, tags"),
    CatalogEntry("bluesky", "Bluesky", "technology", "optional-key:BLUESKY_*", False, 7, "thematic", "post text, author"),
    CatalogEntry("youtube", "YouTube transcripts", "technology", "optional-key:YOUTUBE_API_KEY", False, 7, "thematic", "video title, transcript snippet"),
    CatalogEntry("substack", "Substack RSS", "technology", "keyless", False, 7, "thematic", "post title, summary"),
    CatalogEntry("techmeme", "Techmeme", "technology", "keyless", False, 3, "thematic", "headline"),
    CatalogEntry("podcast-index", "Podcast Index", "technology", "optional-key:PODCAST_INDEX_*", False, 14, "thematic", "episode title, summary"),
    # --- News --------------------------------------------------------------
    CatalogEntry("news", "NewsAPI + RSS", "technology", "free-key:NEWSAPI_KEY", False, 1, "entity", "headline, source, snippet"),
    CatalogEntry("guardian", "The Guardian", "technology", "free-key:GUARDIAN_API_KEY", False, 7, "thematic", "headline, section"),
    CatalogEntry("gdelt", "GDELT", "finance", "keyless", False, 1, "thematic", "event, tone, mentions"),
    # --- Policy & government ----------------------------------------------
    CatalogEntry("gov", "Federal Register + agency RSS", "finance", "keyless", True, 3, "thematic", "rule/notice title, agency"),
    CatalogEntry("gov-contracts", "SAM / SBIR / USAspending", "startups", "optional-key:SAM_API_KEY", True, 30, "corroboration", "award/solicitation title, agency"),
    CatalogEntry("regulations", "Regulations.gov", "finance", "free-key:REGULATIONS_GOV_API_KEY", True, 30, "corroboration", "docket, comment window"),
    CatalogEntry("legistar", "Legistar/Granicus (municipal)", "finance", "keyless", True, 30, "corroboration", "matter title, body, file no."),
    CatalogEntry("openstates", "OpenStates (state bills)", "finance", "free-key:OPENSTATES_API_KEY", True, 30, "corroboration", "bill id, title, latest action"),
    CatalogEntry("courtlistener", "CourtListener (litigation)", "finance", "keyless", True, 30, "corroboration", "case name, court, nature of suit"),
    # --- Markets / forecasting --------------------------------------------
    CatalogEntry("markets", "Polymarket/Manifold/Kalshi", "finance", "keyless", False, 30, "thematic", "question, probability (quote)"),
    CatalogEntry("metaculus", "Metaculus", "finance", "optional-key:METACULUS_TOKEN", False, 30, "thematic", "question, community forecast"),
    # --- Macro / energy / reference ---------------------------------------
    CatalogEntry("macro-rates", "ECB FX + FRED", "finance", "optional-key:FRED_API_KEY", False, 30, "numeric", "series id, observation value"),
    CatalogEntry("eia", "EIA energy", "finance", "free-key:EIA_API_KEY", True, 120, "numeric", "state, period, electricity price"),
    CatalogEntry("wikidata", "Wikidata", "technology", "keyless", False, 1, "entity", "entity enrichment fields"),
    # --- Security ----------------------------------------------------------
    CatalogEntry("nvd", "NVD (CVE)", "technology", "keyless", False, 14, "thematic", "CVE id, CVSS, summary"),
    CatalogEntry("cisa-kev", "CISA KEV", "technology", "keyless", True, 7, "thematic", "CVE id, vendor, due date"),
    # --- Jobs --------------------------------------------------------------
    CatalogEntry("jobs", "Greenhouse/Lever/Ashby", "startups", "keyless", False, 14, "entity", "role, company, location"),
]


def by_id() -> dict[str, CatalogEntry]:
    return {e.id: e for e in CATALOG}


_ROLE_NOTE = {
    "entity": "maps to a tracked company",
    "thematic": "topic/keyword (entity-less)",
    "corroboration": "official 2nd-source, mostly entity-less",
    "numeric": "time-series values",
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
        "cite-or-kill official-source bar.",
        "",
        "| Source | Provider | Domain | Access | ⚖️ | History | Role | Extracted fields kept |",
        "|---|---|---|---|:--:|--:|---|---|",
    ]
    for e in sorted(CATALOG, key=lambda x: (x.role, x.id)):
        official = "⚖️" if e.official else ""
        role = f"{e.role}"
        lines.append(
            f"| `{e.id}` | {e.provider} | {e.domains} | {e.access} | {official} "
            f"| {e.window_days}d | {role} | {e.keeps} |"
        )
    lines += [
        "",
        "**Role key:** "
        + " · ".join(f"*{k}* = {v}" for k, v in _ROLE_NOTE.items())
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
