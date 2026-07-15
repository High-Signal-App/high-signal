# high-signal — PROJECT STATUS

Last updated: 2026-07-15

## Why/What

**Thesis:** One product — a synthesized **Daily Brief** from many noisy public sources across technology, startups, and finance. Global by default; region is a free filter. Five brief sections: (1) stocks watching, (2) business ideas, (3) lifestyle trends, (4) brand perception (connected brand), (5) product improvements (connected brand). Free; no billing.

**In scope:** Daily Brief (`/` `/brief`), Signals feed, Evidence, Track Record, source ingest pipeline, Markets lens, Communities input, Mentions, Agent Eval, Domains (drank companion), Convergence, Unmapped gazetteer, Equities snapshot, operator review/admin, plans 0008–0012 scaffolds.

**Out / parked:** Lab as product infrastructure, personal/operator cockpit as headline product, standalone equities terminal, standalone communities product, broad source expansion without quality gates, paid tiers, per-platform Mentions fan-out, knowledgebase service dependency.

## Dependencies

### External

- **Auth:** Clerk (app shell, admin proxy). Worker admin routes use `ADMIN_TOKEN` bearer.
- **Deploy:** Cloudflare Workers — `high-signal-web`, `high-signal-api`, D1 `high-signal-db`; annotation worker separate deploy.
- **Email:** Cloudflare `send_email` binding (`SEND_EMAIL`) for brief delivery (plan 0009).
- **AI:** OpenAI-compatible endpoint via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `HIGH_SIGNAL_AI_API_KEY`.
- **Ingest sources:** SEC EDGAR, HKEX, yfinance, Polymarket/Manifold/Kalshi/Metaculus, GDELT, RSS, Guardian, FRED, Semantic Scholar, Bluesky, Podcast Index, NVD, CISA KEV, the official YC/Antler/a16z/Techstars directories, and 50+ other adapters (see ingest pipeline). 55 catalog sources, 43 with live data in D1 (180K+ events).
- **Optional source keys:** Guardian, SAM, Companies House, Metaculus, Bluesky, Podcast Index, FRED, Semantic Scholar, Etherscan, Token Unlocks, Artificial Analysis, OpenRouter, Libraries.io, Replicate.
- **Active source keys (set in GitHub Secrets):** `EIA_API_KEY`, `OPENSTATES_API_KEY`, `FDA_API_KEY`, `CONGRESS_API_KEY`, `FEC_API_KEY`, `BEA_API_KEY`, `CENSUS_API_KEY`, `LDA_API_KEY`, `USDA_NASS_API_KEY`, `REGULATIONS_GOV_API_KEY` — all via a single api.data.gov key (registered autonomously via AgentMail + Playwright).
- **Legacy cron fallback:** `MODAL_TRIGGER_*` for Modal long backfills only.
- **Env (representative):** `SEC_USER_AGENT`, `EMAIL_FROM`, `API_BASE` (brief delivery).

### Internal fleet

- **drank:** Web authority companion — `/domains` lens; data via public GitHub JSON + `pnpm drank:sync`.
- **starboard / researchPapers:** Cross-repo ingest adapters referenced from README pipeline list.
- **SaaS Maker:** Personal command brief scripts sync tasks via `pnpm personal:brief sync-tasks --apply`.

- Next.js web app and Cloudflare Worker API monorepo are in place.
- Clerk auth is wired for the app shell with admin helpers.
- Primary nav now reflects active scope: brief, track record, lenses (markets, watchlist, mentions, agent eval, domains), ops (review, settings, explore). Removed dead `/discover` nav link (communities product is parked; link caused prod smoke 404).
- Public/support pages exist: about, methodology, featured, API docs, privacy, terms, auth pages.
- `/explore` ships a canonical sitemap of every reachable surface (brief, signals + evidence, entities, lenses, ideas/opportunities/teardowns, equities, operator/admin, docs), with `new | operator | admin | parked` flags. The site footer now groups links into Product / Lenses / Operator / Legal so nothing built becomes invisible from the homepage.
- Plan 0008/0009/0010/0011 surfaces are reachable from primary nav and the footer: `/watchlist/entities` (nav lenses), `/settings/delivery` (nav ops + footer), `/mentions/[brandId]` (linked from each row in `/mentions`), `/agent-eval/[auditId]/attributes` (linked from each audit panel in `/agent-eval`), `/admin/delivery` (linked from `/explore` under operator/admin). Plan 0012 adds an `intent` tab under `/mentions/[brandId]`.
- Removed `@saas-maker/ops`, `@saas-maker/ai`, `@saas-maker/analytics-sdk`, and shared eslint/tsconfig npm deps (2026-06-20). Workers use local `ai-client.ts`; root lint uses Biome.

### Stack & commands

| Layer | Technology | Deploy target |
| --- | --- | --- |
| Web | Next.js 16, Tailwind v4, Clerk, OpenNext | Cloudflare Worker `high-signal-web` |
| API | Hono, D1 binding | Cloudflare Worker `high-signal-api` |
| DB | Drizzle + D1 (`packages/db`, migrations 0000–0012) | `high-signal-db` |
| Shared | `@high-signal/shared` types, scorers, composers | — |
| Ingest | Python `uv`, edgartools, yfinance, GLiNER, etc. | GitHub Actions cron + optional Modal |
| Lab (parked) | Postgres/pgvector, FastAPI (`python/lab`) | Local docker-compose only |
| Signals store | Git markdown `signals/YYYY-MM-DD/` | Sync scripts → D1 |

```
apps/web          Next.js 16 — brief, lenses, review, settings, legal
workers/api       Hono + D1 — public JSON API, admin ingest hooks, cron delivery
workers/annotation  Python annotation worker (separate deploy)
packages/db       Drizzle schema + SQL migrations
packages/shared   Agent-eval scorer, claim provenance, watchlist impact, OpenLens helpers
python/ingest     Daily source adapters → events/entities → signal candidates
python/lab        Local Postgres substrate (plan 0007, parked)
signals/          Append-only markdown signal cards
scripts/          D1 seed, sync, snapshots, auto-publish, test harnesses
.github/workflows cron-ingest, cron-score, cron-markets, cron-equities, cron-backtest, cron-publish, personal-brief
```

**Data ownership:** D1 is canonical for signals, evidence, entities, mentions, agent-eval, markets, delivery, watchlists, cited URLs. Git markdown under `signals/` is human-readable source synced into D1. JSON bundles (`equities-snapshot`, `price-context`, `market-refreshes`, `known-tickers`) are derived artifacts from `data/equities-snapshot.jsonl` — not independent market-data sources. Prediction markets (`market_quotes`) are separate from equity prices.

```bash
pnpm install
pnpm dev                    # web :3000 + api :8787
pnpm dev:web | pnpm dev:api
pnpm build | pnpm typecheck | pnpm lint
pnpm test                   # all package + script test suites
pnpm db:migrate:local | pnpm db:migrate:remote
pnpm db:seed:local | pnpm db:seed:remote
pnpm product-flow:seed:local | pnpm product-flow:seed:remote
pnpm signals:sync:local | pnpm signals:sync:remote
pnpm signals:publish-drafts:* | pnpm signals:auto-publish:*
pnpm daily:snapshot | pnpm market:snapshot | pnpm price:snapshot
pnpm equities:snapshot | pnpm tickers:bundle | pnpm drank:sync
pnpm personal:brief [refresh-sources|feedback|decide|tasks|sync-tasks|report]
pnpm ingest:local | pnpm source:diagnose | pnpm source:quality | pnpm ingest:preflight
cd python/ingest && uv sync && uv run python -m high_signal_ingest.pipeline --source all --days 1
wrangler d1 migrations list high-signal-db --remote --config workers/api/wrangler.toml
```

**Deploy workflows:** `.github/workflows/deploy-web.yml`, `deploy-api.yml`, `deploy-annotation.yml`.

## Timeline

- **2026-07-13** — Applied and verified remote D1 migrations `0014_intent_opportunities.sql` and `0019_delivery_retry_schedule.sql`. The migration ledger reports no pending migrations; the intent table and three indexes, retry-schedule index, and `delivery_log.next_attempt_at` column are present. No Worker deploy, provider/DNS setup, secret, production config, or mail send was performed.
- **2026-07-13** — Completed plan 0012's remaining local acceptance: open buyer/community intent now enriches Daily Brief section 4 with each brand's strongest source-linked finding and section 5 with deduplicated, reviewable actions. Intent loading fails independently. Web and delivery output retain stage, platform, score, action, and source. Migration 0014 was verified locally and is now applied to remote D1.
- **2026-07-13** — Closed plan 0009's remaining local acceptance gaps. Failed email rows are now owner-scoped and manually retryable from `/settings/delivery` through a conditional failed→queued claim; RSS preferences issue stable opaque tokens for private daily-brief RSS/Atom feeds; signed-in users can read the versioned compact daily-brief JSON contract; and automatic failures persist exact retry eligibility at 15 minutes, 1 hour, and 4 hours before the fourth total attempt becomes terminal. Existing public weekly feeds remain unchanged without a token. Additive migration `0019_delivery_retry_schedule.sql` is applied to remote D1; the Worker change has not been deployed.
- **2026-07-13** — Completed the remaining local-code follow-ups for plans 0008 and 0010. Auto-publish now prefers structured claim links with an explicit legacy fallback; `/review` lazily and idempotently backfills historical claims; stock items expose compact “why this is here” provenance; and signed-in briefs compose up to five suppression-aware direct/one-hop watch impacts, omitting any item without evidence-backed claim linkage. No migration, production config, or deploy was run.
- **2026-07-13** — Added the versioned public `GET /learning/daily` feed for the Fleet unified-learning pipeline. It reuses the canonical Daily Brief composer in-process, emits only compact stock/idea/trend learning items with citations, and deliberately excludes owner-specific perception and improvement sections. Focused API typecheck and full worker test suite pass.
- **2026-07-05** — Added **India D2C Opportunity Pipeline** (plan 0013, Slices 1 + 2). 20 hand-curated India D2C niches → deterministic 0–100 opportunity score → `test / watch / avoid` verdict → `OpportunityBriefPayload` rendered in `/opportunities` (new "India D2C Opportunity Briefs" section) and Daily Brief section 02 (3 briefs for `south-asia`, 1 rotating for `global`). Reuses the existing Opportunity Brief contract — no new component, no D1 migration (JSON artifacts first per the PRD). New `packages/shared/src/content/d2c-opportunities.ts` (seed + `scoreD2CNiche` + `verdictForScore` + `composeD2COpportunityBrief` + `d2cBriefItems`); weekly Python collector `python/ingest/.../d2c_opportunities.py` pulls Reddit/HN/Product-Hunt samples for the 20 niches and writes cited JSON artifacts under `data/d2c-opportunities/`; `scripts/d2c-opportunities-bundle.ts` bundles the latest artifact into the shared package so the worker renders cited evidence without a runtime fs read. Fragile sources (Google Trends, Meta Ad Library, marketplace pages) degrade to `null` with a `freshnessDate`. No impuls8 data read or redistributed; no paid source dependency. Tests: `d2c-opportunities` (TS, 32) + `test_d2c_opportunities.py` (10). Run: `pnpm d2c:collect` then `pnpm d2c:bundle`. Slices 3 (scoring history + D1 persistence) and 4 (agent-visibility overlay) deferred.
- **2026-07-13** — Completed plan 0011's remaining local-code follow-ups: `/mentions` now uses topic/prompt product language, completed mention checks rebuild cited-source evidence independently from intent-opportunity refresh, and visibility reports support owner access or a deterministic brand-scoped HMAC share token. Token creation is owner-gated and token reads fail closed without the existing server signing secret. Migration `0012_cited_url_index.sql` remains an operator apply step; no migration, secret, config, or production change was performed.
- **2026-07-08** — Added **India D2C Opportunity Pipeline Slices 3 + 4** (plan 0013). **Slice 3 — D1 persistence + history:** migration `0016_d2c_opportunities.sql` adds `d2c_niches`, `d2c_niche_snapshots`, and `d2c_agent_visibility` tables (additive, no changes to existing rows). Drizzle schema added in `packages/db/src/schema.ts`. New pure functions in `@high-signal/shared`: `computeD2CDelta` / `computeD2CDeltas` (score delta + verdict-change trend: new/improved/degraded/stable), `assessAging` (aged-well / aged-poorly / stable / insufficient-history), `verdictImproved`, `buildSnapshotRecord`. `scripts/sync-d2c-opportunities.ts` loads the latest JSON artifact into D1 (idempotent upsert by niche + snapshot_date). New `GET /d2c/opportunities` and `GET /d2c/opportunities/:slug` routes read from D1 with seed-fallback. `/opportunities` page now fetches the live API and renders score deltas (±N wk), verdict shifts, and aging. `.github/workflows/cron-d2c-opportunities.yml` runs the weekly Monday 07:00 UTC pipeline: collect → bundle → sync → commit. **Slice 4 — agent-visibility overlay:** `python/ingest/.../d2c_agent_visibility.py` asks each configured AI assistant "What are the best <category> brands in India for <target user>?" for all 20 niches, extracts recommended brands + cited URLs, computes a 0–1 gap score (0 = saturated, 1 = wide-open), and writes `data/d2c-agent-visibility/<YYYY-MM-DD>.json`. `scripts/sync-d2c-agent-visibility.ts` persists the overlay into D1. `GET /d2c/agent-visibility` returns the latest run. The Opportunity Brief now overrides the weekly snapshot's `agentVisibilityScore` with the more-recent overlay gap when available, and `/opportunities` renders "AI recommends: <brands>" or "no brand named — wide-open" per niche. New pnpm scripts: `d2c:agent-visibility`, `d2c:sync`, `d2c:sync:remote`, `d2c:sync-av`, `d2c:sync-av:remote`. Tests: +22 TS (d2c-opportunities now 54) + 10 Python (`test_d2c_agent_visibility.py`). Full `pnpm typecheck` + `pnpm test` + `pnpm lint` + `uv run pytest` + `uv run ruff` green.
- **2026-07-05** — Added **Opportunity Briefs** to Daily Brief section 02. Business ideas now carry a decision-grade payload with `enter/test/watch/avoid` verdict, confidence, target user, problem, market-timing reasons, evidence mix, competitor/pricing/agent-visibility notes, risks, next validation step, and prior hit-rate context when available. Seed fallback ideas demonstrate the full workflow in empty-D1/anonymous views; live community-digest ideas receive conservative validation-oriented defaults until deeper source extraction is added. No migrations, new dependencies, or provider keys.
- **2026-07-09** — Added `/case-studies` as a generated High Signal company-universe surface with individual pages at `/case-studies/[slug]` and paginated index pages at `/case-studies/page/[page]` (50 companies/page). The initial artifact contained **2,181 companies** from a16z, Bessemer, Sequoia, and VCBacked sources. Added D1 persistence in migration `0017_company_universe.sql` plus `pnpm company-universe:sync` / `pnpm company-universe:sync:remote`; API reads are exposed at `/company-universe` and `/company-universe/:slug`. The static JSON remains a build/cache artifact, not the long-term source of record.
- **2026-07-15** — Rebuilt and released the company universe around the requested quality boundary: **only official YC, Antler, a16z, and Techstars directories**. Removed VCBacked, Sequoia, and Bessemer inputs and the 2,200-row cap. Current artifact: **12,964 unique companies** from 13,485 first-party evidence records — YC 6,043, Antler 1,237, a16z 1,099, Techstars 5,106; 397 companies retain multiple selected affiliations. YC and Techstars counts reconcile exactly with provider-reported totals. Added source-level coverage metadata and fail-closed validation, preserved cohort/program/location evidence, and replaced quadratic competitor matching with bounded deterministic indexes; all 12,964 companies have at least one mapped competitor. Added server-rendered search across company descriptions, categories, source affiliations (including YC/a16z aliases), cohort/program/location, and extracted product facets, with the exact UTC last-updated time and an explicitly manual refresh model. A manual local GLiNER pass now extracts **42,669 product/use-case/customer/industry/technology facets across 11,959 companies**; company pages expose those facets and local similar-company clusters with descriptions and deterministic match reasons. The post-enrichment materializer now stores **34,248 reciprocal similarity edges** across every company with a six-peer cap: every displayed A → B recommendation is guaranteed to appear as B → A with identical score/reason metadata. Weak cross-category matches and matches supported only by generic descriptive prose are rejected. Screenpipe is present from official YC evidence and now links reciprocally to Airweave rather than generic cohort or in-memory-database peers. Production D1 stores the full 12,964-company evidence graph and 68,496 directed reciprocal rows; the web build consumes a generated **19.6 MB** runtime snapshot that retains search metadata, NER facets, scores, and reasons while full source evidence is read from D1. This keeps the OpenNext handler at **42.8 MB**, below Cloudflare's 64 MiB uncompressed Worker limit.
- **2026-07-15** — Search now returns **20 companies per page in global match-score order** rather than a fixed top slice. Query-aware previous, next, and numbered links retain the search terms; invalid pages normalize and stale out-of-range pages clamp to the last ranked page. Search submission and page navigation use visible spinner/status pending states with accessible announcements while retaining native GET URLs as fallbacks. Normalized company search documents are cached server-side so the browser receives only the current 20-result page. Materialized similar-company links resolve through a lightweight cached slug map instead of rebuilding the full 12,964-company lexical feature index for every new Worker isolate. On the production-shaped artifact, a broad 6,294-match query measured 63 ms cold and 6.9 ms median warm; first materialized-cluster resolution dropped from 224 ms to 1.6 ms locally.
- **2026-07-09** — Added **company lookup/create** for `/case-studies`. Migration `0018_company_lookup_create.sql` adds on-demand metadata (`status`, `domain`, `requested_by`, `requested_at`, `last_enriched_at`) to `company_universe_companies`. `POST /company-universe/lookup` now normalizes a submitted company name/domain, returns an existing D1 company when matched, or creates a `pending_enrichment` company with operator-submitted provenance and deterministic first-pass competitor edges from the D1 company universe. `/case-studies` includes a lookup form, and `/case-studies/[slug]` falls back to live D1 data for lookup-created companies while still serving generated artifact companies. Production migration/sync not run in this session.
- **2026-07-04** — **AI Visibility (GEO) upgrade** to close the gap vs pure-play GEO tools (Value AI Labs, Peekaboo). Turned the Mentions lens from a single-endpoint, regex-graded check into a real GEO product: (1) **multi-model fan-out** — `resolvePlatforms` runs each prompt across every configured provider (ChatGPT/Gemini/Perplexity/Claude via OpenAI-compatible endpoints), tagging real platforms instead of one `custom` bucket; single-endpoint fallback preserved; (2) **LLM-judge analysis** — `mention-judge` grades each answer (negation-aware sentiment, prose ranking, real recommendation, citations) with the deterministic analyzer as fallback; (3) **persona segmentation** — migration `0015_mention_personas.sql` adds `persona` + `brand_recommended` + `judge_reasoning`; visibility sliceable by buyer persona; (4) **packaged AI Visibility Report** — `composeVisibilityReport` returns a 0–100 score + grade, per-model × per-persona breakdown, share-of-voice vs competitors, citation gaps ("sources AI trusts that aren't you"), and prioritized recommendations, on `GET /products/mentions/:brandId/report`. Also fixed a latent bug: competitor share-of-voice keyed on `[object Object]` because `toMentionRows` cast competitor objects to strings. New suite `ai-visibility` (30 tests); 16 → 17 suites. **Operator step to light up multi-model:** set `OPENAI_API_KEY` / `GEMINI_API_KEY` / `PERPLEXITY_API_KEY` / `ANTHROPIC_API_KEY` on `high-signal-api`; without them it runs single-endpoint as before. Agent-Eval multi-model fan-out deferred (Mentions powers the report).
- **2026-07-04** — Completed plan 0009 brief email delivery (wired the sweep into the `*/30` `scheduled()` cron, live-brief compose, HMAC one-click unsubscribe, 3-strike auto-disable; fixed 3 typecheck errors that left the feature non-compiling). Added `rankEvidenceUrls` to fix a credibility-critical defect: brief citations were leading with off-entity/low-authority sources (Bajaj article under HCL, crates.io under Alphabet, Manifold markets under Intel). Then fixed the root cause upstream in the Python generator: title-weighted attribution with a min-strength floor + a conservative evidence-relevance filter, so off-entity events are no longer attributed or cited (Planned #14, DONE). Then two ranking/guard follow-ups: prediction markets are demoted below all non-market evidence in `rankEvidenceUrls` (crowd opinion never leads), and `buildStocks` drops prediction-market-only signals at read time (canonical `isPredictionMarketOnly` lifted into `@high-signal/shared`, shared with `auto-publish-rules.ts`). **Merged (PRs #34/#35/#36) and deployed to production** (`high-signal-api` + `high-signal-web` Workers); verified live: the market-only Intel signal is gone, Alphabet/HCL lead with on-topic sources, 0 market-only signals in the brief. Test suites 15 → 16 (TS) + `test_entity_attribution.py` (11, Python); `evidence-ranking` 19.
- **2026-07-02** — Added `app.onError()` global error handler to API worker (`workers/api/src/index.ts`).
- **2026-06-09:** Production deploy verified (web + api Workers).
- **Migrations 0000–0007:** Applied; canonical D1 schema for signals, evidence, entities, markets, etc.
- **Migrations 0008–0013:** Applied to remote D1 (2026-06-28). 0008 was manually applied earlier (column + index existed); marked as applied and 0009–0013 applied via `wrangler d1 migrations apply --remote`.
- **Plan 0007:** Lab substrate — partial (local docker Postgres, HN ingest, scorer, FastAPI feed); parked as product infrastructure.
- **Plans 0008–0011:** Claim provenance, brief delivery, watchlists, and OpenLens visibility are wired. Plans 0008, 0010, and 0011 local-code follow-ups are complete; remaining external/operator work is tracked separately.
- **2026-06-30:** Added and scaffolded plan 0012 after reviewing Octolens, Peekaboo, and Subreddit Signals. Decision: beat them by combining AI visibility, citation/source gaps, community buyer intent, proof tasks, and Daily Brief/report outputs instead of copying separate social-listening, GEO, or Reddit-lead dashboards.
- **2026-07-02:** Revamped `/` and `/brief` first viewport around the product loop: market change, buyer intent, AI visibility, and proof gaps. The UI now uses a sharper Aceternity-inspired dark grid treatment while keeping the app surface evidence-first and dense.
- **2026-07-03:** Collapsed the active product shell around data, signals, history, and evals. `/` now renders the signals feed, with Global / US / China / India scopes, default company/idea focus lists, and a fixed sidebar. `/data` is a compact clickable source directory: only sources with stored events open, and they open the latest available source-day view. Signal detail pages link cited evidence back to source-day data when the evidence source maps to the catalog.
- **README status date (2026-05-30)** lags this file for day-to-day scope; `PROJECT_STATUS.md` + `package.json` scripts are authoritative.

## Products

| Product surface | Route / entry | Role |
| --- | --- | --- |
| Daily Brief | `/`, `/brief` | Primary homepage — five synthesized sections |
| Signals & evidence | `/signals`, `/evidence`, `/track-record` | Feed, provenance, hit-rate history |
| Markets lens | `/markets` | Prediction-market quotes (not equity prices) |
| Communities input | `/communities` | Tracked-subreddit digests → brief sections 2–3 |
| Mentions | `/mentions` | Brand visibility, prompts, competitor reports |
| Agent Eval | `/agent-eval` | 8-area evidence scorer + reel briefs |
| Domains (drank) | `/domains` | DR leaderboard + nominations |
| Convergence | `/convergence` | Multi-source entity aggregation + market overlay |
| Unmapped gazetteer | `/unmapped` | Ticker/bare-entity candidates for enrichment |
| Equities snapshot | `/equities` | Sortable table from snapshot pipeline (not a terminal) |
| Operator / admin | `/review`, `/admin/*` | Review queue, ingest hooks, delivery admin |
| Legal & docs | `/about`, `/methodology`, `/privacy`, `/terms`, `/api-docs` | Public trust surfaces |

## Features (shipped)

### Product shell & navigation

- Primary nav + `/explore` sitemap: brief, signals, evidence, lenses (markets, watchlist, mentions, agent eval, domains), operator surfaces, legal.
- Footer grouped Product / Lenses / Operator / Legal.
- Default `/` is the signals home feed. Primary navigation is grouped into `data`, `signals`, `history`, and `evals`; `/brief` remains the source-linked daily brief.
- Public pages: `/about`, `/methodology`, `/featured`, `/api-docs`, `/privacy`, `/terms`, `/sign-in`, `/sign-up`.
- Clerk auth; region picker and seed product pickers on brief.
- SEO JSON-LD tests (`pnpm seo:test`).

### Daily Brief

- `/` and `/brief` render five sections with hit-rate inline on stock claims.
- Worker `GET /brief/daily?region=&owner=` composes from D1 with seed fallback.
- Worker `GET /learning/daily` publishes a compact versioned learning feed derived from public brief sections only.
- Section 02 ideas now render Opportunity Brief context: verdict, confidence, target user/problem, evidence mix, why-now, risk, next validation step, and prior hit-rate where present.
- Digest surfaces: `/digest` (RSS/Atom), `/daily`, `/daily/history`, `/daily/sources`, `/daily/tasks`.
- Convergence callout above composer pulls multi-source entity hits + prediction-market drift.

### Signals, evidence, track record

- D1 tables: `signals`, `evidence`, `score_runs`, `entities`, `relationships`, `events`, `source_documents`.
- Git-versioned markdown store; `pnpm signals:sync:*` scripts.
- Public routes: `/signals`, `/signals/[slug]`, `/signals/today`, `/signals/types`, `/signals/types/[type]`, `/embed/[slug]`.
- `/signals` supports Global / US / China / India scopes plus company/idea focus lists. Signed-out users get a default watchlist for immediate testing; signed-in users can replace it with configured mention brands.
- `/signals/[slug]` shows confidence score, confidence band, source-class reasons, quotes/excerpts, and source-day links back into `/data/:source?date=YYYY-MM-DD` when the evidence maps to the catalog.
- Worker: `GET /signals`, `/signals/facets`, `/signals/:slug`, `/signals/by-entity/:entityId`.
- Review queue `/review`; auto-publish rules (`scripts/auto-publish-drafts.ts`, 29+ rule tests).
- Track record: `/track-record`, `/track-record/labels`, `/backtest-workbench`.
- Worker: `GET /track-record`, `/cohorts`, `/series`, `/workbench`, `/labels`.
- Label backtest replayed weekly by `cron-backtest.yml`.

### Plan 0008 — Signal provenance editor

- Migration `0009_claim_provenance.sql` — **Applied to remote D1** (2026-06-28).
- Tables (local schema): `claim_records`, `claim_evidence_links`, `claim_timeline_events`.
- Shared helpers: `packages/shared/src/claim-provenance.ts`.
- Read routes: `GET /claims/:id`, `GET /claims/by-signal/:slug`.
- Admin write routes: POST/DELETE claim evidence, status, corrections.
- Web: inline provenance editor on `/review`; public provenance section on `/signals/[slug]`.
- Auto-publish consumes structured evidence when claims exist; `/review` lazily backfills historical signals through an authenticated idempotent route; stock brief cards expose compact provenance.
- Tests: `scripts/claim-provenance.test.ts` (36 unit tests) plus structured auto-publish coverage.

### Plan 0009 — Brief distribution (local surfaces complete; gates below)

- Migration `0010_brief_delivery.sql` — **Applied to remote D1** (2026-06-28).
- Migration `0019_delivery_retry_schedule.sql` — **Applied to remote D1** (2026-07-13); adds nullable `delivery_log.next_attempt_at` plus its retry-schedule index.
- Tables: `delivery_preferences`, `delivery_log`, `delivery_snapshots`.
- Worker `/delivery/*`: preferences, log, test, owner-scoped manual retry, compact JSON, cron `POST /delivery/internal/run`; automatic failures persist and enforce the 15m/1h/4h retry schedule, with attempt four terminal.
- Email: Cloudflare `send_email` binding; MIME in `workers/api/src/lib/email.ts`.
- Next.js proxy: `/api/delivery/[...path]`.
- Private feeds: stable opaque per-user RSS token; token-authenticated daily-brief RSS/Atom while no-token requests retain the public weekly digest.
- Web: `/settings/delivery` with failed-row retry and private-feed controls, `/admin/delivery`; admin summary `GET /admin/delivery/summary`.
- Tests: `scripts/brief-delivery.test.ts` (54 assertions) plus worker delivery-completion contract/auth/feed/schedule coverage (214 worker tests total).

### Plan 0010 — Entity watchlists & impact chains

- Migration `0011_watchlists.sql` — **Applied to remote D1** (2026-06-28).
- Tables: `watchlists`, `watchlist_entities`, `watchlist_suppressions`, `watchlist_delta_log`.
- Worker `/watchlists/*`: list/create, add/remove entities, suppressions CRUD, `GET /:id/impact`.
- Next.js proxy: `/api/watchlists/[...path]`.
- Web: `/watchlist/entities`, `/watchlist` hub; "Watch" on `/entities/[id]`.
- Shared impact composer: `packages/shared/src/watchlist-impact.ts`.
- Signed-in `/brief/daily?owner=...` responses include a fault-isolated `watching` block; every surfaced item is linked to an evidence-backed claim and renders relationship/provenance context in `/brief`.
- Tests: `scripts/watchlist-impact.test.ts` (22 unit tests).

### Plan 0011 — OpenLens visibility (scaffolded)

- Migration `0012_cited_url_index.sql` — **Applied to remote D1** (2026-06-28).
- Table: `cited_url_index`.
- Worker under `/products/mentions/:brandId/*`: visibility-matrix, share-of-voice, cited-sources, trends, report.
- Worker: `GET /products/agent-eval/:auditId/attributes`.
- Shared: `packages/shared/src/openlens-visibility.ts`.
- Web: `/mentions/[brandId]` (visibility, sources, trends, report tabs); `/agent-eval/[auditId]/attributes`.
- Tests: `scripts/openlens-visibility.test.ts` (32 focused assertions).

### Plan 0012 — AI visibility and Reddit intent response (local acceptance complete)

- Competitor references: Octolens (broad social listening, API/webhooks/MCP, Slack/email), Peekaboo (AI visibility score, AI-engine tracking, citations/content pickup, GSC/Looker/GA/CMS integrations), Subreddit Signals (Reddit buyer-intent classification, subreddit discovery, reply guidance, managed service).
- Product decision: do not create three standalone products and do not reopen a broad "steal list." Most primitives already exist in Mentions, Agent Eval, plan 0011, `opportunities.py`, and brief sections 4/5.
- Migration `0014_intent_opportunities.sql` — **Applied to remote D1** (2026-07-13; additive table + indexes, no existing-row changes).
- Worker routes under `/products/mentions/:brandId/intent-opportunities`: list, refresh from recent D1 community events, best-effort Agent Eval evidence-task linking, status update, and optional AI reply-draft generation. Mention checks also trigger a defensive background intent refresh.
- Web: `/mentions/[brandId]?tab=intent` renders the brand intent inbox with refresh, draft, done, and dismiss actions; linked evidence tasks are indicated inline; report tab includes top open intent items.
- Daily Brief: owner-scoped sections 4 and 5 now include source-linked intent context and deduplicated next actions; intent query failure preserves existing personal sections.
- Local D1: migration 0014 verified on 2026-07-13 against isolated storage (table + all three indexes).
- Remote verification: `intent_opportunities` and all three expected indexes are present; the migration ledger has no pending entries.
- Plan file: `plans/0012-ai-visibility-and-reddit-intent-response.md`.

### Source ingest pipeline

Python adapters under `python/ingest/src/high_signal_ingest/sources/` — all wired on daily or wider-window cron unless noted:

- **Capital/filings:** SEC EDGAR (8-K, 10-Q/K, Form D/S-1/4/13F), HKEX, IR pages, SEC XBRL fundamentals, Companies House (optional key), USPTO PatentsView (API transition — may return empty).
- **Equities:** Universe 3,226 tickers; yfinance EOD via `equities_daily.py`; `/equities` page; `cron-equities.yml` 21:30 UTC weekdays; tier-1 derivations + tier-2 macro (ECB FX, optional FRED).
- **Jobs:** Greenhouse, Lever, Ashby public boards (curated slugs).
- **Builder:** GitHub releases/trending/archive, Hugging Face Hub, npm/PyPI + OSV, starboard stars.
- **Research:** Semantic Scholar (the papers source). A dedicated arXiv adapter was built and then removed — papers are already covered by Semantic Scholar, no second firehose wanted. OpenAlex remains **not implemented** (was previously over-claimed here).
- **Litigation:** **CourtListener** (`courtlistener.py`, keyless Free Law Project API) — antitrust / IP / M&A opinions; queries scoped to tech/finance and deliberately low-volume/high-precision (case captions like "Brandt v. nVidia" map to entities; the downstream entity gate drops the rest). Corroboration role, classified `official`.
- **Discourse:** **Hacker News** (`hackernews.py`, keyless Algolia API — direct pipeline source, ~10 domain queries × 2 pages, points floor; was previously Lab-only), **Stack Overflow** (`stackexchange.py`, keyless — 15 AI-infra tags, tech-adoption signal; thin post-LLM but functional), Reddit (13 subs), YouTube discovery + transcripts, Bluesky (optional auth), Lobste.rs, Substack RSS, Techmeme, Podcast Index.
- **YouTube brand-awareness probe (2026-07-09):** `YOUTUBE_API_KEY` is stored in Infisical (`dev`) and unlocks official YouTube Data API search/view-count ranking for `scripts/youtube-brand-awareness-probe.py` / `pnpm youtube:brand-probe`. Probe learning: official API is useful for discovery and `>10k views` filtering; it does **not** provide arbitrary third-party transcripts. No-key transcript extraction via `youtube-transcript-api`/`yt-dlp` worked briefly on sample brands (Perplexity, Cursor, Lovable) but then hit IP blocks / HTTP 429, so production transcript coverage needs a provider/proxy-backed lane. Treat YouTube as brand-awareness/perception weak evidence, not cite-or-kill primary evidence.
- **Energy:** **EIA** (`eia.py`) — monthly industrial electricity price for 14 states; numeric-series-as-events. **LIVE** (2026-06-26): key obtained autonomously (Playwright drives the signup form + AgentMail receives verification + key emails), stored in Infisical (Fleet/`dev`) + GitHub repo secret + wired into `cron-ingest`. 56 events.
- **Startups / demand:** **Product Hunt** (`producthunt.py`, keyless RSS — new launches; avoids the OAuth API), **Google Trends** (`google_trends.py`, keyless daily-trends RSS — demand-side signal for new-ideas; noisy, curated downstream), **Apple App Store** (`appstore.py`, keyless top-free chart RSS — consumer *traction*, distinct from PH *launches*). 35 / 20 / 50 events.
- **Reviews / perception (§4 + idea-mining):** **App Store reviews** (`appstore_reviews.py`, keyless iTunes RSS — resolves brand→app-id via the free Search API) and **Google Play reviews** (`playstore_reviews.py`, free `google-play-scraper` lib, lazy-imported optional dep, seeded package names). Real user reviews (1★ complaints = pain-points/idea fuel) for a curated app set + `APPSTORE_REVIEW_APPS`/`PLAYSTORE_REVIEW_APPS` override (point at a connected brand for §4). 95 / 180 events. **SaaS web review sites (Trustpilot/G2) have no free API** — Cloudflare-walled; the only free path is *headed* Playwright (works, but needs xvfb on CI + is anti-bot-fragile), deferred until §4 perception is a priority.
- **Policy:** Federal Register, Regulations.gov (optional), SAM/SBIR/USAspending; **OpenStates** (`openstates.py`) — state-legislature bills (federal→state→municipal policy stack). **LIVE** (2026-06-26): key provided by operator, stored in Infisical + GitHub repo secret + cron-wired. 71 events (Virginia data-center bills: site assessment, sound profile, water use). Classified `official`.
- **Municipal land-use (GatherGov-style):** `legistar.py` — free, key-less Legistar/Granicus Web API across ~18 city/county councils, biased to data-center/fab corridors verified reachable on the API (Phoenix, Mesa, Goodyear, **Maricopa County**, San Jose, Santa Clara, San Antonio, Columbus, Atlanta, **Mecklenburg/Charlotte**, **Racine County** = Microsoft Mount Pleasant; `LEGISTAR_CLIENTS`-overridable). Keyword-filters recent `Matters` to data-center / rezoning / power-purchase / development-agreement items (procedural minutes/communications dropped); classified `official` (counts toward cite-or-kill). **Role = corroboration, not standalone signal** (decided 2026-06-26): municipal records are overwhelmingly entity-less (parcels, local LLCs, thematic items) — verified true entity-map rate ≈1/48 in a 30-day window — so they publish only when they name a tracked data-center operator (5C, QTS, Compass, Vantage — added to the seed; common in NoVA campus filings) or corroborate an existing signal as an official 2nd source. A thematic `data_center_buildout` signal type exists in `signal_types.yaml` and is offered to the LLM for entity-mapped clusters; **standalone entity-less municipal signals are deferred** (would require generator changes to the publish path — see Planned #10). **Tier C (meeting-video transcription, GatherGov's actual moat) is out of scope** — company-sized ASR effort; reopen only if a watchlisted data-center jurisdiction publishes *only* video and its signal is proven valuable. The highest-value region (NoVA Data Center Alley — Loudoun/Prince William/Fairfax/Henrico) and marquee fab towns (Intel Ohio/Oregon, Samsung Taylor, Micron Syracuse) are **not** on Legistar; reaching them needs per-jurisdiction agenda/PDF scraping (CivicPlus/self-hosted), also deferred under the corroboration-only decision.
- **Markets:** Polymarket, Manifold, Kalshi, Metaculus (optional token) — probabilities only, not equity prices; **CoinGecko** (`coingecko.py`, keyless) — crypto trending coins + 24h movers (fills the zero crypto-coverage gap), **DeFiLlama** (`defillama.py`, keyless) — on-chain protocol TVL + 1d moves (capital flows, non-redundant with CoinGecko prices). 15 / ~5 events.
- **Macro:** ECB FX + FRED (`macro_rates.py`); **BLS** (`bls.py`, keyless v1 API, optional `BLS_API_KEY` for v2 limits) — latest CPI / core CPI / unemployment / nonfarm payrolls / earnings / PPI prints as dated events (release-timing gap that FRED's series don't give). 6 events. **SEC Form D** (private fundraising / "who just raised") is already ingested by `edgar` — surfacing it as a startups funding feed is a brief-composition task, not a new source.
- **News:** GDELT, 50+ RSS feeds, Guardian (optional key).
- **US government RSS:** `us_gov_rss.py` — SEC litigation, FTC, DOJ, CFTC, GAO, Nasdaq halts (keyless RSS, 42 events). Historical temporal — enforcement actions and halts have lasting relevance.
- **US government APIs:** `us_gov_api.py` — CFTC COT, Treasury, BEA, Census, Congress, FEC, LDA, CFPB, FDA, NIH, NSF, USGS, NOAA, USDA (1,524 events). Series temporal — macro indicators, legislative tracking, grants. Keyed via api.data.gov.
- **India government:** `india_gov.py` — SEBI, RBI, MOSPI, BSE, NSE, AMFI, NPCI, data.gov.in (11 events). Series temporal. Keyless except data.gov.in.
- **Global macro:** `global_macro.py` — IMF, World Bank, BIS, UN Comtrade (39 events). Series temporal. Keyless.
- **Crypto on-chain:** `crypto_onchain.py` — mempool.space, L2Beat, CoinMetrics, Etherscan, Token Unlocks (4 events). Series temporal. 3 of 5 sub-sources keyless.
- **AI benchmarks:** `ai_benchmarks.py` — LMSYS Arena (keyless), Artificial Analysis, OpenRouter (1 event). Series temporal. LMSYS works keyless; other two need keys.
- **Developer ecosystems:** `dev_ecosystems.py` — Papers with Code, GitLab, Docker Hub, dev.to, libraries.io, Replicate (90 events). 4 of 6 sub-sources keyless.
- **Attention:** Wikipedia pageviews API `GET /attention/:article`; Wikidata enrichment `/enrich/ticker`.
- **Security:** NVD CVE, CISA KEV.
- **Temporal relevance classification (2026-06-28):** Each source tagged `recent` (29 sources — news, social, RSS, stale after days), `historical` (14 — patents, filings, court cases, full archive has value), or `series` (9 — macro, rates, benchmarks, on-chain, both recent prints and historical trends matter). Surfaced in the data directory UI with icons (● ▤ ∿) and contextual notes on source detail pages.

**Operator tooling:** `pnpm source:diagnose`, `pnpm source:quality -- --json`, `docs/ingest-runbook.md`, `docs/source-coverage.md`. Source document dedupe by `document_key` (migration `0008_source_document_keys.sql` — **applied to remote D1** 2026-06-28: column + unique index + backfill). `/admin/events` preserves rich payloads with error logging.

**Data catalog, directory & grouping (2026-06-26 — "get all data and group them, no RAG"):**
- **Storage model** — *extract info and keep the link*: events persist `source_url` + a short extracted `title`/`content` summary (cap 20 KB, usually <2 KB) + dedup hash; raw HTML/PDF/JSON that's one query away is **not** stored. Footprint ≈ KB/day of new signals, low-MB total in D1.
- **`docs/source-catalog.md`** — the data-source table (provider, access/auth, history depth, official-class, role, temporal relevance, extracted fields). Single source of truth `source_catalog.py` (CATALOG), regenerated via `python -m high_signal_ingest.source_catalog`; a test asserts it matches the pipeline `Source` list (no drift). 52 sources.
- **`data_directory.py`** — `python -m high_signal_ingest.data_directory` runs the parallel `fetch('all')`, buckets by source, and writes `data-directory/` (git-ignored, regenerable): `INDEX.md` + one JSON of recent samples per source. Verified live: **180,537 events across 43 source families** in D1 (2026-06-28).
- **`grouping.py`** — deterministic, no-vector grouping of *all* events (incl. entity-less, which the generator drops) by entity + theme (keyword buckets) + source family + day, with a **convergence view** ranking groups by distinct-source corroboration (the cite-or-kill precursor).
- **`dedupe.py`** — deterministic cross-source de-duplication (no embeddings): union-find over **shared canonical URL** (scheme/www/query/fragment stripped; HN's embedded article link extracted) + **title token-Jaccard** (≥0.6, guarded by same-day or shared entity). Collapses the same story from HN/Reddit/Techmeme/news into one, **keeping the distinct-source count as corroboration** (dedup ≠ discard the signal). Wired into `opportunities.py` (no duplicate opportunities) and `data_directory.py` (INDEX reports raw→unique + corroborated count).
- **`opportunities.py`** — RedShip-style (redship.io) monitored, scored inbox over the community sources (Reddit/HN/Stack Overflow/Lobsters/Substack): each item scored 0-100 by brand-keyword relevance + buying/pain intent (reuses `analysis.lightweight_nlp`) + recency, ranked. Deterministic; LLM reply-drafts/alerts/SEO-ranking deferred (map to the existing **Mentions**/**Communities** lenses — see below).

### Lenses & intelligence helpers

- **Markets:** `/markets`, `/markets/history`; prediction-market quotes with auto-publish guardrails; worker `/markets/*`.
- **Communities:** Tracked-subreddit CRUD, digest generation (LLM or deterministic); feeds brief sections 2–3; `/communities`, `/communities/[subreddit]/[period]`; worker `/products/communities/*`.
- **Mentions:** `/mentions`; brand configs, prompts, checks, monitors, competitor report; real LLM fail-closed without `HIGH_SIGNAL_AI_API_KEY`; badge widget.
- **Agent Eval:** `/agent-eval`, `/agent-eval/sample`, `/agent-eval/seo`; 8-area evidence scorer + reel briefs; deterministic fallback without AI key.
- **Domains:** `/domains` — DR leaderboard + nominations from drank companion via `pnpm drank:sync`.
- **Convergence:** `/convergence`; `GET /convergence?hours=&min_sources=` — multi-source entity aggregation + market overlay.
- **Unmapped:** `/unmapped`; `GET /unmapped?hours=` — ticker/bare-entity candidates with one-click CSV row via `/enrich/ticker`.
- **Entities & graph:** `/entities`, `/entities/[id]`, `/entities/[id]/[period]`, `/sectors`, `/opportunities`, `/ideas`, `/personal` (operator, parked as headline).
- **Equities:** `/equities` sortable table from snapshot pipeline.
- **Lab:** `/lab` UI exists; substrate local-only (plan 0007 partial — docker Postgres, HN ingest, scorer, FastAPI feed).

### Operator, automation & CI

- Admin worker routes: sync, scores, events, quotes, ingest-runs, llm-runs, audit summary, pending-scores, backfill-entities.
- GitHub Actions: `ci.yml`, `cron-ingest.yml`, `cron-score.yml`, `cron-markets.yml`, `cron-equities.yml`, `cron-backtest.yml`, `cron-publish.yml`, `personal-brief.yml`, `weekly.yml`, `backfill.yml`.
- Personal command brief scripts → SaaS Maker task sync (`pnpm personal:brief sync-tasks --apply`).
- Annotation worker deploy + contract tests (`pnpm annotation:test`).

## Todo / Planned / Deferred / Blocked

### Planned

0. **Cloudflare CPU abuse incident mitigated (2026-07-12):** Workers analytics
   attributed more than 90% of billing-period CPU to `high-signal-web` and
   `high-signal-api`. A live trace identified a single unverified hosting-ASN
   scanner issuing random page/date combinations over plain HTTP at roughly
   166k requests/day since July 3. The web Worker now rejects the evidenced
   source before OpenNext and redirects all other HTTP requests to HTTPS before
   application execution. A second live trace showed verified GPTBot walking
   unbounded historical `/data/*` and `/daily*` combinations; verified AI
   crawlers now retain reader-facing content but receive a cheap 404 on those
   query-heavy history surfaces, which are also excluded in `robots.txt`. Keep
   the exact-IP guard until traffic remains normal for a full billing cycle;
   prefer a Cloudflare WAF rule when zone-level rules permission is available.

1. **Remaining source API keys (manual signup needed):** `FRED_API_KEY` (macro rates — highest value, 2 min signup), `ETHERSCAN_API_KEY` (Ethereum gas, 2 min), `COMPANIES_HOUSE_API_KEY` (UK filings, 3 min). All others have keyless alternatives or are niche — see session notes. AgentMail inbox `highsignal-keys@agentmail.to` is set up for registrations.
3. **Plan 0009 follow-up:** Complete Email Routing setup (DKIM/SPF + `EMAIL_FROM`) before cron sends real mail. Remote migration 0019 is applied. Checked-in surfaces are otherwise complete: the `*/30` cron is fail-closed and idempotent, automatic failures persist and enforce their next eligible attempt, live-brief compose feeds email/private RSS/private Atom/compact JSON, failed rows are retryable from the owner UI, one-click unsubscribe (HMAC token, RFC 8058 `List-Unsubscribe`) works from any mail client, and 3 consecutive failed rows auto-disable a channel.
6. Clarify event semantics — `normalized_events` vs current `events` as source observations.
7. Keep source pipeline small and quality-gated; run `pnpm source:quality` after full ingest.
8. Promote `/unmapped` candidates into seed CSV; expand curated adapter lists before new firehoses.
9. Tighten brief quality — evidence links, hit-rate context, cull weak inputs.
14. **Evidence attribution — DONE (2026-07-04, credibility-critical).** The live `/brief/daily` (2026-07-04) showed evidence URLs mis-attributed to the wrong entity: HCL `design_win` cited a Bajaj Housing Finance article; Alphabet `capex` cited `crates.io/hashbrown`; Intel `partnership` led with Manifold prediction markets. Root cause: attribution (`_event_entity` → `primary_entity`) scanned the full scraped body (`content[:4000]`) and returned the alphabetically-first gazetteer hit, so a single incidental mention in a "top movers" widget / related-article rail / crate description won. Fixed across three layers:
    - **Attribution** (`extract/entities.py`): `primary_entity` is now title-weighted (`entity_scores`: title match ×4 + body ×1) with a min-strength floor (`_MIN_PRIMARY_SCORE=2`) — an entity mentioned once outside the title is too incidental to own the event → returns None. `_event_entity` scores title + an 800-char lead only (not `[:4000]`). Adapter-assigned `primary_entity_id` (filings/IR) stays authoritative.
    - **Evidence relevance** (`generator.py` `_relevant_events`, applied in `generate` + `generate_batch`): drops an event from a candidate's evidence when its title+lead names *other* tracked entities but neither the subject nor a spillover candidate. Conservative — events naming no tracked entity (bare filings) are kept.
    - **Display** (`brief.ts` `rankEvidenceUrls`, shipped earlier): the two citations a reader sees lead with the strongest/on-topic source.
    - **Market handling** (deployed follow-ups): `rankEvidenceUrls` demotes prediction markets below all non-market evidence (crowd opinion never *leads* a claim), and `buildStocks` drops prediction-market-only signals at read time — a live check found a published Intel signal evidenced entirely by Manifold that the draft-time KILL rule had missed. Canonical `isPredictionMarketOnly` + `PREDICTION_MARKET_DOMAINS` now live in `@high-signal/shared`, shared with `auto-publish-rules.ts` (single source of truth).
    Tests: `tests/test_entity_attribution.py` (11) + `scripts/evidence-ranking.test.ts` (19). **Declined:** a full entity-relevance floor in `auto-publish-rules.ts` — it would duplicate the gazetteer in TS; generation-layer filtering is the correct home for topical relevance.
13. **FINRA short interest (deferred — feasible, fiddly):** free + non-scraping positioning signal (days-to-cover, squeeze risk; maps to tickers). API confirmed accessible at `api.finra.org/data/group/otcMarket/name/consolidatedShortInterest?format=json` (returns real rows at small limits), but the data-platform API caps `limit` low, rate-limits aggressively, and needs offset-pagination + a latest-settlement-period filter to surface notable shorts. Needs a focused pass with proper pagination + backoff; not worth blocking the clean sources. Reopen when wanted.
10. **Entity-less thematic municipal signals — DONE (2026-06-26).** `run()` no longer discards entity-less events: after the entity loop, `_emit_thematic_drafts` clusters them by theme (`grouping.classify_themes`), and themes in `_THEME_SIGNALS` (currently `data-center-buildout` → `THEME_DATACENTER`/`data_center_buildout`) emit a thematic signal **only when backed by ≥2 distinct sources AND ≥2 distinct URLs** (cite-or-kill). Keyed to a seeded `THEME_DATACENTER` pseudo-entity (type=sector, FK-valid, excluded from the gazetteer so it's never *detected* from text). Uses `generator.thematic_candidate` (a real evidence body, not the auto-killed "fallback" marker), so it can publish on its own merit. Additive — never affects the entity path. Add more themes by extending `_THEME_SIGNALS` + seeding a `THEME_*` row. This also unblocks the Tier-B scrapers (NoVA/fab-town records, also entity-less) whenever they're built.
11. **Common-word ticker/alias collisions in the entity gazetteer — DONE (2026-06-26).** `entity_gazetteer` auto-added every ticker as a case-insensitive word-match, so common-English-word tickers polluted the map across **all** text sources (`net`→Cloudflare on "net income", `meta`→Meta on "meta-learning", plus `onto`/`form`/`snow`/`arm`). Fixed in `extract/entities.py` with **case-aware matching**: these six match only the uppercase/`$`-prefixed ticker form (the unambiguous company ref), not the lowercase word; each still resolves via its distinctive full name (Cloudflare, Snowflake, FormFactor, Onto Innovation, Arm Holdings, Meta Platforms/Facebook). Bare-alias cases `TOGETHER`/`SANCTUARY` fixed earlier by tightening aliases.
12. **RedShip-style engagement layer (partial — scorer shipped, rest deferred):** redship.io = Reddit monitoring → 0-100 relevance scoring → daily opportunity inbox → reply drafts → SEO-ranking → alerts. Mapping to High Signal: monitoring + scoring + inbox is **shipped** as `opportunities.py` (deterministic, over all community sources, generalised beyond Reddit). Already-existing analogues: the **Mentions** lens (brand/competitor monitoring, checks), **Communities** lens (tracked subs, digests), and the brand-connected Brief sections 4/5. **Net-new pieces:** (a) auto-keyword generation from a submitted website — deferred; (b) **LLM reply-draft suggestions — DONE** (`opportunities.draft_reply`, via the OpenAI-compatible gateway; operator *suggestions*, not auto-posts; `None` without a key; CLI `--reply --brand --brand-blurb`); (c) SEO-opportunity detection (posts ranking on Google) — deferred (needs SERP data); (d) real-time Slack/email/webhook alerts — deferred (worker/Mentions surface). **Reopening trigger for the deferred pieces:** a brand is connected and wants actionable engagement on the web surface.
13. **Plan 0012 — DONE:** remote migration 0014 is applied. The intent inbox, best-effort evidence-task linking, defensive post-check refresh, report section, operator-reviewed AI reply drafts, and intent-aware brief output are in place.
15. **Plan 0013 — India D2C Opportunity Pipeline (Slices 1–4 DONE 2026-07-08):** 20 curated India D2C niches → deterministic 0–100 score → `test/watch/avoid` verdict → `OpportunityBriefPayload` rendered in `/opportunities` and Daily Brief section 02 (south-asia: 3, global: 1 rotating). Weekly Python collector writes cited JSON artifacts; `pnpm d2c:bundle` bundles the latest into the shared package. **Slice 3 (DONE 2026-07-08):** D1 persistence via `d2c_niches` / `d2c_niche_snapshots` tables (migration 0016), score deltas + verdict-change trends + aging rendered in `/opportunities`, weekly GitHub Actions cron (Mondays 07:00 UTC). **Slice 4 (DONE 2026-07-08):** agent-visibility overlay — `d2c_agent_visibility` table, Python runner asks each AI assistant "best <category> brands in India for <target user>?", extracts recommended brands + cited URLs, computes a 0–1 gap score; the brief overrides `agentVisibilityScore` with the more-recent overlay gap and `/opportunities` renders "AI recommends: <brands>" or "no brand named — wide-open". No impuls8 data, no paid sources. **Operator step to light up the overlay:** set `AI_API_KEY` on the GitHub Actions secrets (or run `pnpm d2c:agent-visibility` locally with `AI_API_KEY` exported); without it the overlay records gap=1 "wide-open" entries.

### Deferred

- **Lab** — local discovery substrate only; not product infrastructure.
- **Personal/operator cockpit** — `/personal` internal tooling.
- **Standalone equities UI** — data feeds brief, not a stock terminal.
- **Standalone communities product** — digest input to ideas/trends only.
- **Broad source expansion** — only when corroboration, novelty, entity coverage, or hit-rate improves.
- **Paid plans / billing** — until usage proves willingness to pay.
- **Per-platform Mentions/Agent Eval fan-out** — single OpenAI-compatible endpoint today.
- **Knowledgebase integration** — separate fleet service; no dependency yet.
- **Signal Studio / marketing playgrounds** — discussed in README; not scoped.

### Blocked

- Brief delivery still requires `EMAIL_FROM`, `API_BASE`, Email Routing, and destination verification before cron sends real mail; remote migration 0019 is complete.
- USPTO PatentsView in ODP transition may return no events.
- Worker `scheduled` handler no-ops unless `MODAL_TRIGGER_URL` set; daily ingest/scoring primary path is GitHub Actions.
- `send_email` binding declared in `workers/api/wrangler.toml`; operator checklist in file comments.
- Production: Cloudflare Workers; no secrets in repo. Modal retained for manual long backfills only.
