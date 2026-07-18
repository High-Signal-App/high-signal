# High Signal feature audit

Date: 2026-06-02

Scope: this audit covers the `high-signal` repository only. It intentionally does not audit the future Knowledgebase service, the external `researchPapers` repository, or a separate GitHub-repository product. Source inventory details live in `docs/operations/data-source-audit.md` and `docs/operations/data-source-inventory.csv`; this document audits application features and data ownership.

Scope reset update, 2026-06-03: active product scope is Daily Brief, Signals, Evidence, Track Record, a small source pipeline, Mentions, Agent Eval, and a narrow Markets lens. Parked areas are Lab, personal/operator cockpit, standalone equities UI, standalone communities product, and broad source expansion. See `docs/product/scope-reset.md`.

## Executive summary

High Signal is currently more than one daily brief application. The repo contains these major systems in one codebase:

1. Public daily brief and signal product.
2. Source ingestion and source-document storage.
3. Entity graph and spillover intelligence.
4. Markets, equities, macro, prediction-market, and backtest data.
5. Community intelligence over Reddit and related discussion sources.
6. Brand/product intelligence: mentions, agent evaluation, evidence tasks, and reel briefs. Mentions and agent eval remain active.
7. Local Lab discovery substrate with Postgres, pgvector, clustering, search, and candidate review. This is now parked.
8. Operator/personal workflow: daily source refreshes, personal brief, requirements queue, source quality, and automation checks. This is now parked as internal-only scope.
9. Public content, SEO, embeds, RSS/Atom, auth, admin, deploy, and cron operations.

The most important boundary issue: `events` are not strictly actionable events today. They are normalized fetched items tied back to `source_documents`. The actionable layer is mostly `signals`, plus some daily/operator derived insights in JSON snapshots. If the product direction is "normalized_events should be actionable only", then the current schema should be split or renamed.

## Product surfaces

| Surface | Purpose | Current data source | Status | Split note |
| --- | --- | --- | --- | --- |
| `/` and `/brief` | Main daily brief with stocks, business ideas, lifestyle trends, brand perception, and product improvement ideas | Worker `/brief/daily`; D1 signals, score runs, community digests, mention checks, agent tasks, seed fallback content | Working app surface with fallback content | Keep in High Signal if this remains the main product |
| `/signals`, `/signals/today`, `/signals/[slug]` | Published/draft signal feed and detail pages | D1 `signals`, `evidence`, `score_runs`, entities | Core feature | Keep in High Signal |
| `/track-record`, `/track-record/labels` | Hit-rate ledger and label-level score history | D1 `signals`, `score_runs`; labels/workbench route | Core moat | Keep in High Signal |
| `/entities`, `/entities/[id]`, `/entities/[id]/[period]` | Entity pages, monthly archives, spillover context | D1 `entities`, `relationships`, signals, price context | Core support feature | Keep entity read model in High Signal; raw entity enrichment can move out |
| `/sectors` | Sector rollups | Entities/signals | Support feature | Keep as read surface |
| `/markets`, `/markets/history` | Market intelligence lens | Market snapshots, signal data, prediction markets | Working lens | Candidate for separate market-data service if scope grows |
| `/equities` | Equity snapshot table with returns and derived fields | Bundled equity snapshot JSON and D1 market schema | Working lens; data-heavy | Strong candidate to isolate as market-data service or module |
| `/backtest-workbench` | Backtest and cohort workbench | Worker `/track-record/workbench` and score data | Working operator/admin feature | Keep if hit-rate ledger remains core |
| `/convergence` | Cross-source convergence signals | Worker `/convergence` over source/event/signal data | Working route | Keep as insight layer, not raw source layer |
| `/unmapped` | Gazetteer/entity candidates | Worker `/unmapped`; source/event text | Operator quality feature | Keep until source processing moves elsewhere |
| `/review` | Draft/published/killed override queue | Worker `/admin/signals` and patch/delete routes | Working admin feature | Keep in High Signal |
| `/review/lab-candidates` | Turns Lab candidates into signal draft templates | Local Lab API feed | Working when Lab server is running | Bridge feature; can be retired or redesigned after split |
| `/communities` and community archive routes | Track subreddits, generate digests, discover public communities | D1 `tracked_communities`, `community_digest_snapshots`, Reddit fetch helpers | Working lens | Could remain as source lens or move into ingestion service |
| `/mentions` | Brand mention visibility across AI prompts and external monitors | D1 mention config/check/result tables; AI endpoint | Working product-intel feature | Candidate separate "brand intelligence" product/module |
| `/agent-eval`, `/agent-eval/sample`, `/agent-eval/seo` | Evaluate whether AI agents/LLMs recommend a brand/product | D1 agent audit/response/score/task/reel tables; AI endpoint; SEO probe | Working product-intel feature | Candidate separate service/product |
| `/lab` | Local-first discovery/search/feed UI | Local FastAPI Lab server via `LAB_API_URL` | Optional local feature | Candidate separate substrate; already uses separate Postgres |
| `/daily`, `/daily/history`, `/daily/sources`, `/daily/tasks` | Operator daily read, source health, requirements queue | Bundled daily-source refresh JSON, personal/product flow snapshots, annotations | Working operator workflow | Internal cockpit; not necessarily product surface |
| `/personal` | Personal command brief | Local JSONL/JSON personal source registry and snapshots | Working operator workflow | Separate from public High Signal product unless explicitly productized |
| `/opportunities`, `/ideas`, `/watchlist`, `/teardowns` | Product opportunity, idea intelligence, watchlist, manual teardown flows | Shared intelligence functions, daily/community snapshots, approved task specs | Working/plausibly operator-facing | Decide whether these feed the brief or belong to operator cockpit |
| `/digest` and feed routes | Weekly digest, RSS/Atom feeds | Worker `/digest/*`, RSS helpers | Working read endpoints; email not wired | Keep if daily brief distribution remains core |
| `/embed/[slug]` | Embeddable signal card | Signal detail API | Working support feature | Keep only if public sharing matters |
| `/about`, `/methodology`, `/featured`, `/api-docs`, legal/auth pages | Public/static/app shell pages | Static content and app metadata | Working support feature | Keep with web app |

## API surfaces

| Route group | Purpose | Data owned or touched | Status | Boundary note |
| --- | --- | --- | --- | --- |
| `/signals` | Signal list/detail APIs | `signals`, `evidence`, `score_runs`, `entities` | Core | High Signal insight API |
| `/entities` | Entity and relationship read APIs | `entities`, `relationships`, related signals | Core | High Signal read model |
| `/track-record` | Cohorts, time series, labels, workbench | `score_runs`, signals and labels | Core | Hit-rate ledger |
| `/digest` | Weekly/RSS/Atom content | Signals and brief content | Working | Distribution API |
| `/brief` | Daily brief composition | Signals, score runs, communities, mentions, agent tasks, seed fallback | Core | Main product API |
| `/admin` | Signal sync, source event ingestion, runs, quotes, audit, patch/delete | Broad schema including `source_documents`, `events`, `signals`, `llm_runs`, `ingest_runs`, `market_quotes` | Critical internal API | Too broad; should be broken into source ingest/admin/signal admin if split |
| `/sectors` | Sector rollups | Entities/signals | Support | High Signal read API |
| `/markets` | Market/prediction-market read API | Market quotes and market snapshots | Working | Candidate market-data boundary |
| `/communities` | Community top posts/search helpers | Reddit helper APIs | Working | Source/lens boundary |
| `/products` | Dashboard, communities, mentions, agent eval, SEO audit | Brand/product-intel tables plus community data | Broad product-intel API | Strong split candidate |
| `/convergence` | Multi-source convergence view | Source/event/signal data | Working | Insight API |
| `/unmapped` | Unmapped entity candidates | Source/event text and gazetteer | Working | Source quality API |
| `/enrich` | Enrichment endpoint | Entity/source context | Working route present | Clarify ownership before expanding |
| `/attention` | Attention/article endpoint | Attention source context | Working route present | Source/lens boundary |

The Worker scheduled handler also dispatches ingest and scoring jobs when `MODAL_TRIGGER_URL`, `MODAL_SCORE_URL`, and `MODAL_TRIGGER_TOKEN` are configured. GitHub Actions are now the documented daily cron path, while Modal is retained for ad-hoc/backfill use.

## Data model audit

### Core source, event, and signal tables

| Table | Meaning today | Producer | Consumer | Boundary concern |
| --- | --- | --- | --- | --- |
| `source_documents` | Canonical fetched source document keyed by source + canonical URL; stores raw text/JSON/parsed fields | Python ingest via `/admin/events` | Debug/replay, event linkage, future source audit | Good central source-store primitive |
| `events` | Normalized fetched item: source URL, title/content, published date, entity, raw hash, source document link | Python ingest via `/admin/events` | Signal generation, convergence, unmapped candidates, audit | Name conflicts with desired "actionable normalized events" meaning |
| `ingest_runs` | Source pipeline run audit | Python ingest via `/admin/ingest-runs` | Admin/source health | Good ops/audit primitive |
| `llm_runs` | LLM prompt/response audit for signal generation | Signal generator/admin | Debug/replay | Good audit primitive |
| `signals` | Curated prediction/insight with direction, confidence, window, review status, body markdown | Markdown sync, generation, review admin | Brief, signals, entities, track record, feeds | Core High Signal object |
| `evidence` | Evidence rows attached to signals | Signal sync/admin | Signal details, cite-or-kill | Core High Signal object |
| `score_runs` | Outcome scoring and hit/miss/push/pending ledger | Score/backtest scripts | Track record, brief hit-rate, labels | Core moat |

Recommended cleanup: either rename current `events` concept to `observations`/`source_events` in documentation and code over time, or introduce a new `normalized_events` table for actionable events only. Do not overload the current `events` table with both meanings.

### Entity graph tables

| Table | Meaning today | Status | Boundary note |
| --- | --- | --- | --- |
| `entities` | Public/private/sector/product entities with ticker/country/sector metadata | Core and seeded | Keep as High Signal read model |
| `relationships` | Supplier/customer/peer/subsidiary/partner/competitor graph with evidence URL and verified flag | Core and seeded | Keep spillover graph, but raw enrichment can be produced elsewhere |

### Market and equity tables

| Table | Meaning today | Status | Boundary note |
| --- | --- | --- | --- |
| `market_quotes` | Prediction-market quotes from Polymarket/Manifold/Kalshi | Integrated but treated as non-publishable evidence by auto-publish rules | Keep as weak/context signal only |
| `tickers` | Ticker universe and identifiers | Built in migration 0006 | Candidate market-data service primitive |
| `closes` | Rolling close/volume series | Built | Data-heavy; isolate if it grows |
| `ticker_snapshot` | Derived daily metrics: returns, volatility, 52-week levels, moving averages, fundamentals, attention counts | Built and surfaced in `/equities` | Strong market-data boundary candidate |
| `index_memberships` | Index membership | Built | Market-data module |
| `fx_rates` | FX rate history | Built | Market-data module |
| `risk_free_rates` | Macro/risk-free series | Built | Market-data module |
| `institutional_holders` | 13F-style institutional holder rows | Built | Market-data module |
| `insider_transactions` | Insider transaction rows | Built | Market-data module |

Stock prices are not duplicated as one-day/three-day/everything in separate core tables. The intended normalized model is raw close series in `closes` plus derived latest-window metrics in `ticker_snapshot`. There are also bundled JSON snapshots for the web (`data/equities-snapshot.jsonl`, `apps/web/src/data/equities-snapshot.json`) that should be treated as generated artifacts/read bundles, not separate sources of truth.

### Community tables

| Table | Meaning today | Status | Boundary note |
| --- | --- | --- | --- |
| `tracked_communities` | User/admin tracked subreddit + prompt + period | Working | Could remain product config or move to source service |
| `community_digest_snapshots` | Generated summaries/trends/actions from tracked communities | Working | Insight artifact; feeds brief ideas/trends |

### Brand and agentic product-intelligence tables

| Table | Meaning today | Status | Boundary note |
| --- | --- | --- | --- |
| `mention_brand_configs` | Brand, aliases, competitors, AI endpoint/model, schedule, badge config | Working | Separate product-intel candidate |
| `mention_prompts` | Prompts to test brand visibility | Working | Separate product-intel candidate |
| `mention_checks` | Run-level mention check summary | Working | Separate product-intel candidate |
| `mention_results` | Per prompt/platform/model response analysis | Working | Separate product-intel candidate |
| `agent_evaluation_audits` | Brand/product AI readiness audit | Working | Separate product-intel candidate |
| `agent_evaluation_responses` | Per prompt/surface response rows | Working | Separate product-intel candidate |
| `agent_evidence_scores` | Evidence area scores from agent eval | Working | Separate product-intel candidate |
| `agent_evidence_tasks` | Follow-up tasks generated from evidence gaps | Working and feeds brief section 5 | Separate product-intel candidate |
| `reel_briefs` | Short-form content briefs from audit evidence | Built | Likely different product than data aggregation |

## Ingestion and source pipeline

`python/ingest/src/high_signal_ingest/pipeline.py` is the main orchestrator:

1. Fetch events from source adapters.
2. Persist fetched items/source documents through `/admin/events`.
3. Resolve a primary entity.
4. Cluster by entity and independent source families.
5. Generate signal candidates through the LLM generator or fallback generator.
6. Emit markdown drafts into `signals/YYYY-MM-DD/`.
7. Push `ingest_runs` with fetch/drop/draft/error counters.

Current source adapters in the repo:

| Adapter | Included in `--source all` | Notes |
| --- | --- | --- |
| `edgar` | Yes | Daily 8-K; wider windows add expanded filings |
| `news` | Yes | RSS/news/blog feeds; see source audit for feed list |
| `reddit` | Yes | Community/discussion source |
| `ir` | Yes | Investor relations feeds/pages |
| `github` | Yes | Repo/API-style source; no token assumed in audit |
| `github_archive` | Yes | GitHub event archive style source |
| `gov` | Yes | Government/security/economic feeds |
| `huggingface` | Yes | Model/dataset/community momentum |
| `youtube` | Yes | Transcript/video source where available |
| `bluesky` | Yes | Social discussion source |
| `gdelt` | Yes | Global news/event attention source |
| `hkex` | Yes | HKEX/company filing source |
| `markets` | Yes | Prediction markets and market quotes |
| `cisa_kev` | Yes | Known exploited vulnerability catalog |
| `lobsters` | Yes | Technical discussion source |
| `substack` | Yes | Curated blog/newsletter source |
| `techmeme` | Yes | Tech news aggregator source |
| `package_registries` | Yes | Package release/momentum source |
| `jobs` | Yes | Hiring demand source |
| `nvd` | Yes | Vulnerability database source |
| `guardian` | Yes | News source |
| `patents` | Yes | Patent trend/source source |
| `gov_contracts` | Yes | Contracting/procurement source |
| `semantic_scholar` | Yes | Research paper source adapter inside this repo |
| `regulations` | Yes | Regulatory feeds/source |
| `metaculus` | Yes | Forecast/events source (distinct from `market_quotes`) |
| `podcast_index` | Yes | Podcast/transcript-like source |
| `macro_rates` | Yes | Macro rate source |
| `sec_xbrl` | Yes | SEC XBRL/fundamental source |
| `wikidata` | No, explicit only | Entity enrichment/backfill |
| `companies_house` | No, explicit only | Company registry enrichment |

The source pipeline is useful, but it currently mixes raw source storage, source-specific fetching, entity normalization, signal generation, and D1 admin writes in one flow.

## Python Lab substrate

`python/lab` is already structurally separate from the D1 app:

| Module | Purpose | Status |
| --- | --- | --- |
| `db.py` / `schema.sql` | Local Postgres schema with FTS, pgvector, documents, repos, HN threads, links, entities, runs | Built |
| `ingest.py` | HN top stories and submitted URLs | Built |
| `materialize.py` | Fetch one-hop outbound links | Built |
| `github_trending.py` | Scrape GitHub trending without API token | Built |
| `embed.py` | Optional MiniLM embeddings and HNSW index creation | Built, optional |
| `extract_entities.py` | Optional GLiNER entity extraction | Built, optional |
| `summarize.py` | Optional local/OpenAI-compatible summarization | Built, optional |
| `cluster.py` | Story clustering by links and embedding similarity | Built |
| `score.py` | Ranking score using HN, recency, velocity, GitHub momentum | Built |
| `server.py` | FastAPI `/feed`, `/search`, `/stats`, `/healthz` | Built |

Lab is already a candidate separate subsystem because it owns a different database, runtime, and retrieval/search shape. The web app only consumes it through `LAB_API_URL`.

## Scripts and automation

| Script/workflow area | Purpose | Status | Boundary note |
| --- | --- | --- | --- |
| `pnpm ingest:local` | Run Python ingest for one day | Working command | Source pipeline |
| `pnpm source:quality` and source registry tests | Validate source health/inventory quality | Working | Source governance |
| `pnpm daily:snapshot` | Build daily source refresh bundle | Working | Operator/internal |
| `pnpm market:snapshot` / `price:snapshot` / `equities:snapshot` / `tickers:bundle` | Build market/equity/read bundles | Working | Market-data module |
| `pnpm signals:sync:*` | Sync markdown signals into D1 | Working | Core High Signal |
| `pnpm signals:auto-publish:*` | Deterministic + AI publish/kill decision | Working and tested | Core High Signal ops |
| `pnpm personal:brief` | Generate personal command brief | Working | Operator/internal |
| `cron-ingest.yml`, `cron-score.yml`, `cron-publish.yml` | Daily ingest, scoring, auto-publish | Present | Core ops |
| `cron-markets.yml`, `cron-equities.yml`, `cron-backtest.yml` | Market/equities/backtest refresh | Present | Market-data ops |
| `personal-brief.yml`, `weekly.yml` | Personal/weekly automation | Present | Operator/distribution |
| `deploy-api.yml`, `deploy-web.yml` | Deploy automation (only two deploy workflows; no annotation worker) | Present | App ops |
| `backfill.yml` | Backfill automation | Present | Source/data ops |
| `ci.yml` | Build/test gate | Present | App ops |

## Local/generated data artifacts

| Artifact | Meaning | Boundary note |
| --- | --- | --- |
| `data/equities-snapshot.jsonl` | Generated equities snapshot bundle | Derived artifact, not source of truth |
| `apps/web/src/data/equities-snapshot.json` | Web-consumable equity bundle | Derived artifact |
| `data/product-flow-refresh.jsonl` | Product/daily flow refresh records | Operator/internal or brief input |
| `apps/web/src/data/daily-source-refreshes.json` | Web-consumable daily source refreshes | Derived artifact |
| Personal source registry/snapshots | Personal command brief source definitions and outputs | Internal operator data, not core product source truth |

These generated artifacts are useful for fast read surfaces but should not be treated as independent source systems. When a generated artifact exists alongside D1 tables, the audit should name one canonical owner and treat the other as cache/read bundle.

## Feature grouping by likely owner

The forward-looking "which features would belong to which service if we split"
breakdown (core / source pipeline / market data / brand intelligence / Lab /
operator cockpit) is archived at
[`docs/archive/stale-feature-audit-owner-grouping.md`](https://github.com/High-Signal-App/high-signal/blob/main/docs/archive/stale-feature-audit-owner-grouping.md).
The locked decision is **one product, lenses not deployables** (`agents.md`,
[`direction.md`](direction.md)); that breakdown is a thought exercise, not a plan.

## Current duplication and mesh concerns

1. Source documents are now keyed by source + canonical URL, which is the right anti-duplication primitive for raw documents.
2. Current `events` dedupe by `raw_hash` prevents exact duplicate normalized items, but it is not the same as actionable-event dedupe.
3. Market price storage is mostly well-shaped: raw time series in `closes`, latest derived windows in `ticker_snapshot`, generated JSON bundles for fast web reads.
4. Prediction markets are stored separately in `market_quotes` and auto-publish rules intentionally prevent prediction-market-only evidence from becoming a signal.
5. Community digests are insight artifacts, not raw Reddit source documents. If raw Reddit posts need durable storage, they should go through the same source-document/event path or a source service.
6. Lab documents are not stored in D1; they live in local Postgres. This is already a separate storage island.
7. Personal/daily JSON files are currently a parallel read model. They are acceptable as generated artifacts, but they should not become another canonical source store.

## Recommended immediate cleanup before building more

1. Decide the naming boundary for `events`.
   - Option A: keep the current table but document it as `source_events` / normalized observations.
   - Option B: add a new actionable `normalized_events` model and leave current `events` as source observations.
2. Mark generated JSON artifacts as derived read bundles in docs and tests.
3. Pick one canonical owner for stock/equity data. Recommended: market data module/service owns time series and derived snapshots; High Signal consumes snapshots for insights.
4. Keep brand intelligence separate at the API boundary even if it remains in this repo for now.
5. Add a retention/shelf-life policy by data class:
   - Raw source documents: keep while useful for replay/audit, then archive or compact.
   - Source observations/current `events`: retain enough for source health and signal replay.
   - Actionable normalized events: retain longer, because they are insight inputs.
   - Signals/evidence/score runs: append-only, long-lived.
   - Market closes: rolling multi-year window.
   - Ticker snapshots: latest plus optional daily snapshot history if backtests need it.
   - Community/mention/agent eval runs: retain recent operational history; archive old raw responses if storage grows.
6. Keep source addition gated by quality:
   - Every source should have a source class, expected use, canonical key, freshness expectation, dedupe rule, and culling rule.
   - "More data" should not enter the brief unless it improves corroboration, novelty, entity coverage, or hit-rate.

## Open decisions for Sarthak

1. Should High Signal own raw source ingestion, or should it consume normalized observations from a data service?
2. Should market/equity data be isolated now, or only after the next growth in coverage/storage?
3. Are mentions and agent evaluation part of High Signal's customer-facing product, or just inputs to another product?
4. Should `/daily` and `/personal` be treated as internal operator cockpit pages and hidden from the main product IA?
5. What is the first canonical definition of an actionable `normalized_event`?
6. Which generated bundles are allowed to remain as caches, and which should be replaced by D1/API reads?

## Bottom line

High Signal can remain one repo for now, but the internal boundaries should be made explicit:

- High Signal core: brief, signals, evidence, score ledger, entity spillover.
- Source/data pipeline: fetch, source documents, normalized source observations, source health.
- Market data: ticker universe, closes, snapshots, macro/ownership/insider data.
- Brand intelligence: mentions, agent evaluation, evidence tasks, reels.
- Lab: local discovery/search substrate.
- Operator cockpit: personal/daily workflows and generated bundles.

The immediate risk is not that the repo has too many features; it is that several different data layers are named and handled as if they are the same thing. Cleaning up `events` semantics and declaring source-of-truth ownership for markets and generated bundles will make the rest of the structure much easier to split or keep.
