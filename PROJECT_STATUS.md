# high-signal — PROJECT STATUS

Last updated: 2026-06-20

## Why/What

**Thesis:** One product — a synthesized **Daily Brief** from many noisy public sources across technology, startups, and finance. Global by default; region is a free filter. Five brief sections: (1) stocks watching, (2) business ideas, (3) lifestyle trends, (4) brand perception (connected brand), (5) product improvements (connected brand). Free; no billing.

**In scope:** Daily Brief (`/` `/brief`), Signals feed, Evidence, Track Record, source ingest pipeline, Markets lens, Communities input, Mentions, Agent Eval, Domains (drank companion), Convergence, Unmapped gazetteer, Equities snapshot, operator review/admin, plans 0008–0011 scaffolds.

**Out / parked:** Lab as product infrastructure, personal/operator cockpit as headline product, standalone equities terminal, standalone communities product, broad source expansion without quality gates, paid tiers, per-platform Mentions fan-out, knowledgebase service dependency.

## Dependencies

### External

- **Auth:** Clerk (app shell, admin proxy). Worker admin routes use `ADMIN_TOKEN` bearer.
- **Deploy:** Cloudflare Workers — `high-signal-web`, `high-signal-api`, D1 `high-signal-db`; annotation worker separate deploy.
- **Email:** Cloudflare `send_email` binding (`SEND_EMAIL`) for brief delivery (plan 0009).
- **AI:** OpenAI-compatible endpoint via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `HIGH_SIGNAL_AI_API_KEY`.
- **Ingest sources:** SEC EDGAR, HKEX, yfinance, Polymarket/Manifold/Kalshi/Metaculus, GDELT, RSS, Guardian, FRED, Semantic Scholar, Bluesky, Podcast Index, NVD, CISA KEV, and 40+ other adapters (see ingest pipeline).
- **Optional source keys:** Guardian, SAM, Regulations.gov, Companies House, Metaculus, Bluesky, Podcast Index, FRED, Semantic Scholar.
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
- Plan 0008/0009/0010/0011 surfaces are reachable from primary nav and the footer: `/watchlist/entities` (nav lenses), `/settings/delivery` (nav ops + footer), `/mentions/[brandId]` (linked from each row in `/mentions`), `/agent-eval/[auditId]/attributes` (linked from each audit panel in `/agent-eval`), `/admin/delivery` (linked from `/explore` under operator/admin).
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

- **2026-06-09:** Production deploy verified (web + api Workers).
- **Migrations 0000–0007:** Applied; canonical D1 schema for signals, evidence, entities, markets, etc.
- **Migrations 0008–0012:** Scaffolded locally; **NOT applied to remote D1** — plans 0008–0011 blocked on apply.
- **Plan 0007:** Lab substrate — partial (local docker Postgres, HN ingest, scorer, FastAPI feed); parked as product infrastructure.
- **Plans 0008–0011:** Claim provenance, brief delivery, watchlists, OpenLens visibility — code wired; pending migration apply + follow-ups.
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
- Public pages: `/about`, `/methodology`, `/featured`, `/api-docs`, `/privacy`, `/terms`, `/sign-in`, `/sign-up`.
- Clerk auth; region picker and seed product pickers on brief.
- SEO JSON-LD tests (`pnpm seo:test`).

### Daily Brief

- `/` and `/brief` render five sections with hit-rate inline on stock claims.
- Worker `GET /brief/daily?region=&owner=` composes from D1 with seed fallback.
- Digest surfaces: `/digest` (RSS/Atom), `/daily`, `/daily/history`, `/daily/sources`, `/daily/tasks`.
- Convergence callout above composer pulls multi-source entity hits + prediction-market drift.

### Signals, evidence, track record

- D1 tables: `signals`, `evidence`, `score_runs`, `entities`, `relationships`, `events`, `source_documents`.
- Git-versioned markdown store; `pnpm signals:sync:*` scripts.
- Public routes: `/signals`, `/signals/[slug]`, `/signals/today`, `/signals/types`, `/signals/types/[type]`, `/embed/[slug]`.
- Worker: `GET /signals`, `/signals/facets`, `/signals/:slug`, `/signals/by-entity/:entityId`.
- Review queue `/review`; auto-publish rules (`scripts/auto-publish-drafts.ts`, 29+ rule tests).
- Track record: `/track-record`, `/track-record/labels`, `/backtest-workbench`.
- Worker: `GET /track-record`, `/cohorts`, `/series`, `/workbench`, `/labels`.
- Label backtest replayed weekly by `cron-backtest.yml`.

### Plan 0008 — Signal provenance editor (scaffolded)

- Migration `0009_claim_provenance.sql` — **NOT applied to remote D1**.
- Tables (local schema): `claim_records`, `claim_evidence_links`, `claim_timeline_events`.
- Shared helpers: `packages/shared/src/claim-provenance.ts`.
- Read routes: `GET /claims/:id`, `GET /claims/by-signal/:slug`.
- Admin write routes: POST/DELETE claim evidence, status, corrections.
- Web: inline provenance editor on `/review`; public provenance section on `/signals/[slug]`.
- Tests: `scripts/claim-provenance.test.ts` (29 unit tests).

### Plan 0009 — Brief distribution (scaffolded)

- Migration `0010_brief_delivery.sql` — **NOT applied to remote D1**.
- Tables: `delivery_preferences`, `delivery_log`, `delivery_snapshots`.
- Worker `/delivery/*`: preferences, log, test, cron `POST /delivery/internal/run`.
- Email: Cloudflare `send_email` binding; MIME in `workers/api/src/lib/email.ts`.
- Next.js proxy: `/api/delivery/[...path]`.
- Web: `/settings/delivery`, `/admin/delivery`; admin summary `GET /admin/delivery/summary`.
- Tests: `scripts/brief-delivery.test.ts` (24 unit tests).

### Plan 0010 — Entity watchlists & impact chains (scaffolded)

- Migration `0011_watchlists.sql` — **NOT applied to remote D1**.
- Tables: `watchlists`, `watchlist_entities`, `watchlist_suppressions`, `watchlist_delta_log`.
- Worker `/watchlists/*`: list/create, add/remove entities, suppressions CRUD, `GET /:id/impact`.
- Next.js proxy: `/api/watchlists/[...path]`.
- Web: `/watchlist/entities`, `/watchlist` hub; "Watch" on `/entities/[id]`.
- Shared impact composer: `packages/shared/src/watchlist-impact.ts`.
- Tests: `scripts/watchlist-impact.test.ts` (20 unit tests).

### Plan 0011 — OpenLens visibility (scaffolded)

- Migration `0012_cited_url_index.sql` — **NOT applied to remote D1**.
- Table: `cited_url_index`.
- Worker under `/products/mentions/:brandId/*`: visibility-matrix, share-of-voice, cited-sources, trends, report.
- Worker: `GET /products/agent-eval/:auditId/attributes`.
- Shared: `packages/shared/src/openlens-visibility.ts`.
- Web: `/mentions/[brandId]` (visibility, sources, trends, report tabs); `/agent-eval/[auditId]/attributes`.
- Tests: `scripts/openlens-visibility.test.ts` (22 unit tests).

### Source ingest pipeline

Python adapters under `python/ingest/src/high_signal_ingest/sources/` — all wired on daily or wider-window cron unless noted:

- **Capital/filings:** SEC EDGAR (8-K, 10-Q/K, Form D/S-1/4/13F), HKEX, IR pages, SEC XBRL fundamentals, Companies House (optional key), USPTO PatentsView (API transition — may return empty).
- **Equities:** Universe 3,226 tickers; yfinance EOD via `equities_daily.py`; `/equities` page; `cron-equities.yml` 21:30 UTC weekdays; tier-1 derivations + tier-2 macro (ECB FX, optional FRED).
- **Jobs:** Greenhouse, Lever, Ashby public boards (curated slugs).
- **Builder:** GitHub releases/trending/archive, Hugging Face Hub, npm/PyPI + OSV, starboard stars.
- **Research:** Semantic Scholar (the papers source). A dedicated arXiv adapter was built and then removed — papers are already covered by Semantic Scholar, no second firehose wanted. OpenAlex remains **not implemented** (was previously over-claimed here).
- **Litigation:** **CourtListener** (`courtlistener.py`, keyless Free Law Project API) — antitrust / IP / M&A opinions; queries scoped to tech/finance and deliberately low-volume/high-precision (case captions like "Brandt v. nVidia" map to entities; the downstream entity gate drops the rest). Corroboration role, classified `official`.
- **Discourse:** **Hacker News** (`hackernews.py`, keyless Algolia API — direct pipeline source, ~10 domain queries × 2 pages, points floor; was previously Lab-only), **Stack Overflow** (`stackexchange.py`, keyless — 15 AI-infra tags, tech-adoption signal; thin post-LLM but functional), Reddit (13 subs), YouTube transcripts, Bluesky (optional auth), Lobste.rs, Substack RSS, Techmeme, Podcast Index.
- **Energy:** **EIA** (`eia.py`, free key → skipped without `EIA_API_KEY`) — monthly industrial electricity price for 14 data-center/fab states, numeric-series-as-events like FRED; powers the data-center power thesis. Built to v2 schema; not verified live (needs a key).
- **Policy:** Federal Register, Regulations.gov (optional), SAM/SBIR/USAspending; **OpenStates** (`openstates.py`, free key → skipped without `OPENSTATES_API_KEY`) — state-legislature bills (the layer between federal `gov` and municipal `legistar`), scoped to data-center / AI / semiconductor topics in the relevant state corridors. Built to the documented v3 schema; **not yet verified live** (needs a key). Corroboration role, classified `official`.
- **Municipal land-use (GatherGov-style):** `legistar.py` — free, key-less Legistar/Granicus Web API across ~18 city/county councils, biased to data-center/fab corridors verified reachable on the API (Phoenix, Mesa, Goodyear, **Maricopa County**, San Jose, Santa Clara, San Antonio, Columbus, Atlanta, **Mecklenburg/Charlotte**, **Racine County** = Microsoft Mount Pleasant; `LEGISTAR_CLIENTS`-overridable). Keyword-filters recent `Matters` to data-center / rezoning / power-purchase / development-agreement items (procedural minutes/communications dropped); classified `official` (counts toward cite-or-kill). **Role = corroboration, not standalone signal** (decided 2026-06-26): municipal records are overwhelmingly entity-less (parcels, local LLCs, thematic items) — verified true entity-map rate ≈1/48 in a 30-day window — so they publish only when they name a tracked data-center operator (5C, QTS, Compass, Vantage — added to the seed; common in NoVA campus filings) or corroborate an existing signal as an official 2nd source. A thematic `data_center_buildout` signal type exists in `signal_types.yaml` and is offered to the LLM for entity-mapped clusters; **standalone entity-less municipal signals are deferred** (would require generator changes to the publish path — see Planned #10). **Tier C (meeting-video transcription, GatherGov's actual moat) is out of scope** — company-sized ASR effort; reopen only if a watchlisted data-center jurisdiction publishes *only* video and its signal is proven valuable. The highest-value region (NoVA Data Center Alley — Loudoun/Prince William/Fairfax/Henrico) and marquee fab towns (Intel Ohio/Oregon, Samsung Taylor, Micron Syracuse) are **not** on Legistar; reaching them needs per-jurisdiction agenda/PDF scraping (CivicPlus/self-hosted), also deferred under the corroboration-only decision.
- **Markets:** Polymarket, Manifold, Kalshi, Metaculus (optional token) — probabilities only, not equity prices.
- **News:** GDELT, 50+ RSS feeds, Guardian (optional key).
- **Attention:** Wikipedia pageviews API `GET /attention/:article`; Wikidata enrichment `/enrich/ticker`.
- **Security:** NVD CVE, CISA KEV.

**Operator tooling:** `pnpm source:diagnose`, `pnpm source:quality -- --json`, `docs/ingest-runbook.md`, `docs/source-coverage.md`. Source document dedupe by `document_key` (migration `0008_source_document_keys.sql` — pending remote apply). `/admin/events` preserves rich payloads.

**Data catalog, directory & grouping (2026-06-26 — "get all data and group them, no RAG"):**
- **Storage model** — *extract info and keep the link*: events persist `source_url` + a short extracted `title`/`content` summary (cap 20 KB, usually <2 KB) + dedup hash; raw HTML/PDF/JSON that's one query away is **not** stored. Footprint ≈ KB/day of new signals, low-MB total in D1.
- **`docs/source-catalog.md`** — the data-source table (provider, access/auth, history depth, official-class, role, extracted fields). Single source of truth `source_catalog.py` (CATALOG), regenerated via `python -m high_signal_ingest.source_catalog`; a test asserts it matches the pipeline `Source` list (no drift).
- **`data_directory.py`** — `python -m high_signal_ingest.data_directory` runs the parallel `fetch('all')`, buckets by source, and writes `data-directory/` (git-ignored, regenerable): `INDEX.md` + one JSON of recent samples per source. Verified live: **1,326 samples across 21 live keyless sources** in a 3-day window.
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

1. **Apply pending D1 migrations in order:** `0008_source_document_keys.sql`, `0009_claim_provenance.sql`, `0010_brief_delivery.sql`, `0011_watchlists.sql`, `0012_cited_url_index.sql` — verify with `wrangler d1 migrations list --remote`.
2. **Plan 0008 follow-ups:** auto-publish reads claim records; lazy historical backfill; brief provenance affordance.
3. **Plan 0009 follow-ups:** Email Routing operator setup; hourly delivery cron; bounce/retry UX.
4. **Plan 0010 follow-ups:** wire `watching` section into brief composer; claim linkage.
5. **Plan 0011 follow-ups:** topic/prompt copy rename; post-check cited-source refresh hook; report token auth.
6. Clarify event semantics — `normalized_events` vs current `events` as source observations.
7. Keep source pipeline small and quality-gated; run `pnpm source:quality` after full ingest.
8. Promote `/unmapped` candidates into seed CSV; expand curated adapter lists before new firehoses.
9. Tighten brief quality — evidence links, hit-rate context, cull weak inputs.
10. **Entity-less thematic municipal signals (deferred, needs own plan):** `cluster_and_generate` (`pipeline.py`) drops every event with no entity, so the majority of municipal records (parcels, "Data Center Uniform Standards", local-LLC applicants) never become signals — entity-map rate ≈1/48. The corroboration-only path (operator named / official 2nd source) is shipped and works; making municipal items publish *standalone* on the `data_center_buildout` theme requires a thematic entity-less clustering path through the publish gate. Touches production behavior → separate plan + review. **Reopening trigger:** corroboration value proves real AND we want regional data-center-buildout signals that don't name a tracked equity. The same change is the prerequisite for the deferred Tier-B scrapers (NoVA counties, fab towns — also entity-less).
11. **Common-word ticker/alias collisions in the entity gazetteer (cleanup):** `entity_gazetteer` auto-adds every ticker + alias as a case-insensitive word-match, so common-English-word tickers/aliases pollute the map across **all** text sources — confirmed `ONTO` (Onto Innovation ticker → "onto") and `FORM` (FormFactor → "form") matching common words in source text; bare-alias cases `TOGETHER`/`SANCTUARY` already fixed by tightening aliases. Tickers can't be fixed by alias-editing (auto-added from the ticker field). Fix = a small lowercase stoplist of common-word terms skipped in `_compiled_patterns` (`extract/entities.py`). Low-risk, improves map precision everywhere; deferred as its own focused cleanup.
12. **RedShip-style engagement layer (partial — scorer shipped, rest deferred):** redship.io = Reddit monitoring → 0-100 relevance scoring → daily opportunity inbox → reply drafts → SEO-ranking → alerts. Mapping to High Signal: monitoring + scoring + inbox is **shipped** as `opportunities.py` (deterministic, over all community sources, generalised beyond Reddit). Already-existing analogues: the **Mentions** lens (brand/competitor monitoring, checks), **Communities** lens (tracked subs, digests), and the brand-connected Brief sections 4/5. **Deferred net-new pieces:** (a) auto-keyword generation from a submitted website; (b) LLM reply-draft suggestions; (c) SEO-opportunity detection (community posts already ranking on Google); (d) real-time Slack/email/webhook alerts. These belong on the worker API + Mentions schema, not the Python data layer — own plan. **Reopening trigger:** a brand is connected and wants actionable engagement, not just intelligence.

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

- Migrations 0008–0012 scaffolded locally; **remote D1 not applied** — features depending on new tables fail or no-op in production until apply.
- Brief delivery requires `EMAIL_FROM`, `API_BASE`, Email Routing, destination verification before cron sends real mail.
- Brief `watching` section not wired despite watchlist scaffold.
- USPTO PatentsView in ODP transition may return no events.
- Worker `scheduled` handler no-ops unless `MODAL_TRIGGER_URL` set; daily ingest/scoring primary path is GitHub Actions.
- `send_email` binding declared in `workers/api/wrangler.toml`; operator checklist in file comments.
- Production: Cloudflare Workers; no secrets in repo. Modal retained for manual long backfills only.
