# Project Status

Last updated: 2026-06-13

This is the single project-status doc for High Signal. It tracks what is done, what is planned next, and what is deferred/parked. Detailed supporting docs can exist, but this file is the first place to check before changing product scope.

## Current Scope

High Signal is an evidence-backed daily intelligence brief.

Active scope:

- Daily Brief
- Signals
- Evidence
- Track Record / hit-rate ledger
- Small source pipeline
- Narrow Markets lens
- Mentions
- Agent Eval

Parked scope:

- Lab
- Personal/operator cockpit
- Standalone equities UI
- Standalone communities product
- Broad source expansion

## Done

### Product and app shell

- Next.js web app and Cloudflare Worker API monorepo are in place.
- Clerk auth is wired for the app shell with admin helpers.
- Primary nav now reflects active scope: brief, track record, lenses (markets, watchlist, mentions, agent eval, domains), ops (review, settings, explore).
- Public/support pages exist: about, methodology, featured, API docs, privacy, terms, auth pages.
- `/explore` ships a canonical sitemap of every reachable surface (brief, signals + evidence, entities, lenses, ideas/opportunities/teardowns, equities, operator/admin, docs), with `new | operator | admin | parked` flags. The site footer now groups links into Product / Lenses / Operator / Legal so nothing built becomes invisible from the homepage.
- Plan 0008/0009/0010/0011 surfaces are reachable from primary nav and the footer: `/watchlist/entities` (nav lenses), `/settings/delivery` (nav ops + footer), `/mentions/[brandId]` (linked from each row in `/mentions`), `/agent-eval/[auditId]/attributes` (linked from each audit panel in `/agent-eval`), `/admin/delivery` (linked from `/explore` under operator/admin).

### Daily brief

- `/` and `/brief` render the daily brief.
- Brief has five intended sections:
  - Stocks watching for a boom.
  - Business ideas to build.
  - New lifestyle trends.
  - How the market perceives your products.
  - Ideas to improve your products.
- Region picker and seed product picker are wired.
- Worker route `/brief/daily` composes the brief from real data when present and seed fallback data when D1 is empty or incomplete.
- Seed fallback content exists for stocks, ideas, trends, regions, and demo products.

### Signals, evidence, and track record

- Core D1 tables exist for `signals`, `evidence`, `score_runs`, `entities`, and `relationships`.
- Markdown signal memory under `signals/YYYY-MM-DD/` is the versioned signal store.
- Signal sync scripts exist for local and remote D1.
- Signal feed/detail/today/type/entity surfaces exist.
- Review queue supports draft, published, corrected, and killed statuses.
- Signal provenance editor scaffolded (plan 0008): migration `0009_claim_provenance.sql` with `claim_records`, `claim_evidence_links`, `claim_timeline_events`; worker public reads at `/claims/*`; admin writes at `/admin/claims/*`; inline provenance editor in `/review` with role-tagged evidence chips and status transitions; public provenance section on `/signals/[slug]`; 29 unit tests in `scripts/claim-provenance.test.ts`. Migration not yet applied to local/remote D1.
- Brief distribution scaffolded (plan 0009): migration `0010_brief_delivery.sql` with `delivery_preferences`, `delivery_log` (unique day-channel idx), `delivery_snapshots`; worker `/delivery/*` + cron `/delivery/internal/run`; email transport uses Cloudflare's native `send_email` binding (`workers/api/wrangler.toml` declares `[[send_email]] name = "SEND_EMAIL"`; worker reads `env.SEND_EMAIL` + `env.EMAIL_FROM`; MIME built inline, no third-party API); `/settings/delivery` + `/admin/delivery` pages; new `/api/delivery/[...path]` Clerk-only proxy; 24 unit tests in `scripts/brief-delivery.test.ts`. Email Routing setup on the zone + DKIM/SPF + destination-address verification are operator follow-ups.
- Watchlists + impact chains scaffolded (plan 0010): migration `0011_watchlists.sql` with `watchlists`, `watchlist_entities`, `watchlist_suppressions`, `watchlist_delta_log`; worker `/watchlists/*` (CRUD + suppressions + impact); pure composer in `packages/shared/src/watchlist-impact.ts` with observed/inferred labelling and priority math; `/watchlist/entities` page; Watch button on `/entities/[id]`; new `/api/watchlists/[...path]` Clerk-only proxy; 20 unit tests in `scripts/watchlist-impact.test.ts`. Brief composer `watching` section integration is the next concrete follow-up.
- OpenLens visibility surface scaffolded (plan 0011): migration `0012_cited_url_index.sql` with `cited_url_index`; new worker routes under `/products/mentions/:brandId/{visibility-matrix,share-of-voice,cited-sources,cited-sources/refresh,trends,report}` and `/products/agent-eval/:auditId/attributes`; ownership classifier + share-of-voice + trend math in `packages/shared/src/openlens-visibility.ts`; `/mentions/[brandId]` page with visibility / sources / trends / report tabs; `/agent-eval/[auditId]/attributes` grid; 22 unit tests in `scripts/openlens-visibility.test.ts`. Topic/prompt copy rename across existing /mentions surface is a follow-up.
- Auto-publish rules exist and are tested.
- Track record is public and uses score runs/hit-rate logic.
- Hit-rate family fallback exists so new signal types can borrow family-level confidence when direct history is thin.

### Source pipeline and source storage

- Python ingest pipeline fetches source items, resolves entities, clusters events, generates signal candidates, emits markdown drafts, and records ingest runs.
- Source adapters exist for filings, RSS/news/blogs, Reddit, IR pages, GitHub-style sources, government feeds, YouTube, GDELT, markets, security feeds, packages, jobs, Hugging Face, patents, regulations, macro rates, SEC XBRL, and related enrichment sources.
- Source inventory and source audit docs exist:
  - `docs/data-source-audit.md`
  - `docs/data-source-inventory.csv`
- Source availability diagnostic exists: `pnpm source:diagnose` reports which optional credentials/tools are present without printing secret values.
- Source document handling has been tightened in the working tree:
  - `source_documents.document_key` represents source + canonical URL.
  - Source documents are intended to dedupe by document key, not by raw hash alone.
  - `/admin/events` preserves richer source-document payloads instead of replacing them with fallback event payloads.

### Mentions

- Mention Intelligence remains active.
- Brand configs, aliases, competitors, platforms, prompts, checks, and results are modeled in D1.
- `/mentions` supports brand configuration, prompt management, running checks, and recent check history.
- Mention execution can call an OpenAI-compatible endpoint and analyze brand mention, sentiment, competitor mentions, citations, and badge/report data.
- Mentions feed the brief's brand-perception section.
- Monthly competitor report added as mentions/reporting surface (product brief in shared + seed fixture for 3 products; sections for notable moves, hiring/launch/social+AI chatter; uncertainty notes when evidence thin; all claims evidence-linked; route at /products/mentions/competitor-report (seed + real overlay from mentionResults); existing config report enriched with competitorReport). Uses only existing mentions/evidence/tables.

### Agent Eval

- Agent Eval remains active.
- Agent audits, responses, evidence scores, evidence tasks, and reel briefs are modeled in D1.
- `/agent-eval`, `/agent-eval/sample`, and `/agent-eval/seo` exist.
- Real AI execution is wired when `HIGH_SIGNAL_AI_API_KEY` or `OPENAI_API_KEY` is set; deterministic fallback exists without a key.
- Agent evidence tasks feed the brief's product-improvement section.

### Domains (web authority lens)
- New integration at `/domains`.
- Consumes shared DR (Domain Rating) leaderboard and community nominations from the companion standalone "drank" app (Vercel, localStorage predictions, GitHub Action pipeline for global data).
- DR treated as a high-signal for website/source authority/quality.
- Full interactive features (predictions, personal lists, charts) live in the independent drank app at https://drank-sand.vercel.app.
- Data available via local `data/dr-domains.json` (synced with `pnpm drank:sync`) or runtime fetch.
- Linked from PrimaryNav under lenses.

### Markets and equities

- Narrow Markets lens remains active.
- Market quote storage exists for prediction markets, with auto-publish rules preventing prediction-market-only evidence from publishing as a signal.
- Equity data model exists: `tickers`, `closes`, `ticker_snapshot`, index memberships, FX rates, risk-free rates, institutional holders, and insider transactions.
- Equity snapshot builders and generated read bundles exist.
- Standalone equities UI exists but is parked as a product direction.

### Communities

- Community digest tables and routes exist.
- `/communities` can track subreddits, generate digests, show latest digests, and discover public community data.
- Communities are now an input to ideas/trends, not an active standalone product.

### Lab

- Local Lab substrate exists under `python/lab`.
- Lab has local Postgres/pgvector schema, HN ingest, one-hop materialization, GitHub trending scrape, embeddings, entity extraction, summarization, clustering, scoring, and FastAPI feed/search/stats/health endpoints.
- `/lab` exists and consumes `LAB_API_URL`.
- Lab is parked and should not be treated as required product infrastructure.

### Operator/internal workflows

- `/daily`, `/daily/history`, `/daily/sources`, `/daily/tasks`, and `/personal` exist.
- Personal command brief scripts and source registry/snapshots exist.
- Daily source refresh, requirements queue, source quality, and automation status helpers exist.
- These are internal/operator tooling, not active customer-facing product scope.

### Automation

- GitHub Actions exist for CI, ingest, score, publish, markets, equities, backtest, weekly, personal brief, backfill, and deploy.
- Modal support remains for ad-hoc/backfill use.
- Package scripts exist for DB migrations/seeding, signal sync, auto-publish, source quality, snapshots, and tests.
- Production deploy was verified on 2026-06-09:
  - `high-signal-api` deployed at version `eedfd365-510b-4877-904f-99c890be11cf`.
  - `high-signal-web` deployed at version `a275a754-5d6f-4106-8455-59f6ef61e272`.
  - Apex and `www` smoke checks passed via public Cloudflare DNS resolution, and browser render passed at 1280px.

## Planned Next

1. Clarify event semantics.
   - Current `events` are normalized source observations.
   - Planned direction: reserve `normalized_events` for actionable events only, or rename/document current `events` as `source_events`.

2. Keep source pipeline small and quality-gated.
   - Every active source must have a canonical key, freshness expectation, dedupe rule, use in the brief, and culling rule.
   - Do not add more sources just to increase volume.
   - Use `pnpm source:diagnose` before `pnpm source:quality` when a source looks empty, so missing credentials/tools are not confused with poor source yield.

3. Make source-of-truth ownership explicit.
   - D1 tables should own canonical app state.
   - Generated JSON/JSONL bundles should be documented as derived read artifacts.
   - Market/equity data needs one canonical owner before further expansion.

4. Tighten active brief quality.
   - Make sure each brief item can point to enough evidence.
   - Keep hit-rate context visible where claims are made.
   - Cull or downgrade weak inputs that do not improve insights.

5. Continue Mentions and Agent Eval integration.
   - Keep them focused on brand perception and product-improvement sections.
   - Do not expand them into unrelated content/SEO products unless explicitly approved.

6. Verify production/data readiness.
   - Apply remote D1 migration `0008_source_document_keys.sql` before treating source-document dedupe semantics as current.
   - Keep deploy workflow and cron health green after the next pushed product change.

7. Plans 0008–0011 have all been promoted into active scope and scaffolded (see Done).
   - Migrations to apply (in order, idempotent): `0009_claim_provenance.sql`, `0010_brief_delivery.sql`, `0011_watchlists.sql`, `0012_cited_url_index.sql`. Run `pnpm db:migrate:local` and `pnpm db:migrate:remote`.
   - Operator follow-ups:
     - 0008: refactor `scripts/auto-publish-drafts.ts` to read `claim_records` instead of free-form `evidenceUrls`; lazy backfill of existing signals into structured claims on first `/review` open.
     - 0009: enable Email Routing on the zone, verify DKIM/SPF for the sending domain, and either set `allowed_destination_addresses` on the `[[send_email]]` binding to a fixed allow-list or accept Cloudflare's per-destination verification flow. Set `EMAIL_FROM` and `API_BASE` in worker `[vars]` (without `API_BASE` the cron logs an explicit error and skips every user). Add a GitHub Actions workflow that POSTs to `/delivery/internal/run` hourly with the worker `ADMIN_TOKEN`.
     - 0010: wire the watching section into `workers/api/src/routes/brief.ts` so `/brief/daily?owner=…` includes it when the user has at least one watched entity.
     - 0011: rename product copy from keyword/query to topic/prompt across `apps/web/src/app/mentions/page.tsx`; trigger `POST /products/mentions/:brandId/cited-sources/refresh` after each mention check.

## Deferred / Parked

### Lab

Parked as optional local discovery/search substrate. Do not expand it unless it directly improves the active brief or becomes a separate product decision.

### Personal/operator cockpit

Parked as internal tooling. Keep it available for Sarthak's workflow, but do not present it as the product.

### Standalone equities UI

Parked as a product direction. Market data can feed signals and the brief, but High Signal should not become a stock terminal right now.

### Standalone communities product

Parked as a product direction. Communities can feed ideas/trends, but `/communities` should not drive roadmap work unless the active brief needs it.

### Broad source expansion

Parked. Add sources only when they materially improve corroboration, novelty, entity coverage, or hit-rate.

The `mvanhorn/last30days-skill` workflow is useful as an operator research reference, but it should not be imported as a production dependency or source of truth. Adopt the good patterns: recent-window research, source availability diagnostics, people-weighted attention, raw evidence trails, and cross-source clustering.

### Paid plans and billing

Deferred until usage proves willingness to pay.

### Per-platform Mentions / Agent Eval fan-out

Deferred. Current implementation uses one OpenAI-compatible endpoint and custom platform tagging. Reopen only if users need provider-level breakdowns.

### Knowledgebase service

Deferred for this repo. Future shape can be a separate service with ingest/search APIs, but High Signal should not depend on it yet.

### External research/GitHub products

Deferred from this project status. External `researchPapers` and separate GitHub-repository products are not audited here.

## Supporting docs

- Product scope reset: `docs/scope-reset-2026-06-03.md`
- Feature audit: `docs/feature-audit.md`
- Data source audit: `docs/data-source-audit.md`
- Data source inventory: `docs/data-source-inventory.csv`
- Data service boundary: `docs/data-service-boundary.md`
- Product spec: `SPEC.md`
- Agent instructions: `agents.md`

## Maintenance rule

When a feature ships, moves back into active scope, gets parked, or is intentionally deferred, update this file in the same change. Supporting docs may go deeper, but they should not contradict this file.
