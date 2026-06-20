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
- **Research:** arXiv, OpenAlex, Semantic Scholar.
- **Discourse:** HN (lab), Reddit (13 subs), YouTube transcripts, Bluesky (optional auth), Lobste.rs, Substack RSS, Techmeme, Podcast Index.
- **Policy:** Federal Register, Regulations.gov (optional), SAM/SBIR/USAspending.
- **Markets:** Polymarket, Manifold, Kalshi, Metaculus (optional token) — probabilities only, not equity prices.
- **News:** GDELT, 50+ RSS feeds, Guardian (optional key).
- **Attention:** Wikipedia pageviews API `GET /attention/:article`; Wikidata enrichment `/enrich/ticker`.
- **Security:** NVD CVE, CISA KEV.

**Operator tooling:** `pnpm source:diagnose`, `pnpm source:quality -- --json`, `docs/ingest-runbook.md`, `docs/source-coverage.md`. Source document dedupe by `document_key` (migration `0008_source_document_keys.sql` — pending remote apply). `/admin/events` preserves rich payloads.

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
