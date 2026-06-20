# Project Recommendation Context

Generated: 2026-06-06T21:14:19.566Z

This file is a CodeVetter Repo Unpacked-inspired audit written for Starboard recommendations. It is intentionally local, evidence-oriented, and safe to commit: it records product context, feature areas, stack inventory, and recommendation guidance without secrets or environment values.

## Project Identity

- Slug: `high-signal`
- Registry description: Public signal log for AI infrastructure and semiconductors.
- Product grouping: `public-ready`
- Source path: `high-signal`

## Product Context

Public signal log for AI infrastructure and semiconductors.

High Signal is an evidence-backed daily intelligence brief. Active scope: - Daily Brief - Signals - Evidence - Track Record / hit-rate ledger - Small source pipeline - Narrow Markets lens - Mentions - Agent Eval Parked scope: - Lab - Personal/operator cockpit - Standalone equities UI - Standalone communities product - Broad source expansion

High Signal High Signal is one product : a synthesized Daily Brief assembled from many noisy public sources. It covers three knowledge domains — technology, startups, finance — globally by default and filtered to any region a user picks. The brief has five sections. The first three are public; the last two appear once the user connects a brand. 1. Stocks watching for a boom — hit-rate inline on every claim. 2. Business ideas to build — surfaced from community demand. 3. New lifestyle trends — community + cultural drift. 4. How the market perceives your products — mention intelligence. 5. Ideas to improve your products — agent-readiness gaps. Everything else in the repo Markets, Communities, 

## Feature Map

- **AI agents**: Agents, tool use, workflows, orchestration, RAG, evals, and model integration. Keywords: ai, agent, agents, llm, rag, embedding, eval, model.
- **Cloudflare and deploy**: Workers, Pages, edge runtime, queues, storage, and deploy automation. Keywords: cloudflare, worker, workers, pages, edge, deploy, wrangler, queue.
- **Content and media**: Content production, video, reels, documents, markdown, and publishing workflows. Keywords: content, media, video, reel, markdown, document, publish, editor.
- **Analytics and intelligence**: Signal analysis, forecasting, monitoring, trends, metrics, and decision support. Keywords: analytics, intelligence, signal, forecast, monitoring, metric, trend, insight.
- **Search and discovery**: Search, ranking, recommendations, feeds, semantic retrieval, and discovery UX. Keywords: search, discovery, recommend, ranking, semantic, feed, index, retrieval.
- **Database and storage**: SQL, document storage, migrations, cache, queues, vectors, and persistence. Keywords: database, db, sql, sqlite, postgres, turso, libsql, drizzle.
- **UI workflows**: Dashboards, tables, forms, component systems, charts, and user workflows. Keywords: ui, ux, dashboard, table, component, react, next, tailwind.

## Runtime Surfaces and Entrypoints

- `apps/web/src/app/about/page.tsx`
- `apps/web/src/app/agent-eval/page.tsx`
- `apps/web/src/app/api-docs/page.tsx`
- `apps/web/src/app/backtest-workbench/page.tsx`
- `apps/web/src/app/brief/page.tsx`
- `apps/web/src/app/communities/page.tsx`
- `apps/web/src/app/convergence/page.tsx`
- `apps/web/src/app/daily.json/route.ts`
- `apps/web/src/app/daily/page.tsx`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/digest.json/route.ts`
- `apps/web/src/app/digest/page.tsx`
- `apps/web/src/app/entities.json/route.ts`
- `apps/web/src/app/entities/page.tsx`
- `apps/web/src/app/equities/page.tsx`
- `apps/web/src/app/featured/page.tsx`
- `apps/web/src/app/humans.txt/route.ts`
- `apps/web/src/app/ideas/page.tsx`
- `apps/web/src/app/lab/page.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/llms.txt/route.ts`
- `apps/web/src/app/markets.json/route.ts`
- `apps/web/src/app/markets/page.tsx`
- `apps/web/src/app/mentions/page.tsx`
- `apps/web/src/app/methodology/page.tsx`
- `apps/web/src/app/opportunities/page.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/personal/page.tsx`
- `apps/web/src/app/privacy/page.tsx`
- `apps/web/src/app/review/page.tsx`
- `apps/web/src/app/sectors/page.tsx`
- `apps/web/src/app/signals.json/route.ts`
- `apps/web/src/app/signals/page.tsx`
- `apps/web/src/app/teardowns/page.tsx`
- `apps/web/src/app/terms/page.tsx`
- `apps/web/src/app/track-record/page.tsx`
- `apps/web/src/app/unmapped/page.tsx`
- `apps/web/src/app/watchlist/page.tsx`
- `workers/api/src/index.ts`
- `workers/api/src/routes/admin.ts`
- `workers/api/src/routes/attention.ts`
- `workers/api/src/routes/brief.ts`

## Current Stack

- Languages: `Python`, `TypeScript`
- Frameworks/tools: `Cloudflare Workers`, `Drizzle`, `Next.js`, `OpenNext Cloudflare`, `Playwright`, `React`, `Tailwind CSS`, `Vitest`
- Config files:
- `apps/web/next.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/wrangler.toml`
- `packages/db/drizzle.config.ts`
- `python/ingest/pyproject.toml`
- `python/lab/pyproject.toml`
- `workers/annotation/pyproject.toml`
- `workers/annotation/wrangler.toml`
- `workers/api/vitest.config.ts`
- `workers/api/wrangler.toml`

## OSS Already In Use

Direct dependencies:
- `@clerk/nextjs`
- `@high-signal/db`
- `@high-signal/shared`
- `@saas-maker/feedback`
- `clsx`
- `drizzle-orm`
- `geist`
- `hono`
- `jose`
- `lucide-react`
- `next`
- `posthog-js`
- `react`
- `react-dom`
- `tailwind-merge`

Development dependencies:
- `@cloudflare/workers-types`
- `@opennextjs/cloudflare`
- `@playwright/test`
- `@saas-maker/eslint-config`
- `@saas-maker/prettier-config`
- `@saas-maker/tsconfig`
- `@storybook/addon-docs`
- `@storybook/nextjs`
- `@tailwindcss/postcss`
- `@tailwindcss/typography`
- `@types/node`
- `@types/react`
- `@types/react-dom`
- `drizzle-kit`
- `husky`
- `next`
- `postcss`
- `storybook`
- `tailwindcss`
- `tsx`
- `typescript`
- `vitest`
- `wrangler`

Package scripts:
- `annotation:test`
- `build`
- `build-storybook`
- `cf:build`
- `competitor-perception:prototype`
- `competitor-perception:test`
- `daily-automation:test`
- `daily-range:test`
- `daily-source-audit:test`
- `daily:seed-history`
- `daily:snapshot`
- `db:migrate:local`
- `db:migrate:remote`
- `db:seed:local`
- `db:seed:remote`
- `deploy`
- `dev`
- `dev:api`
- `dev:web`
- `equities:snapshot`
- `generate`
- `ingest:local`
- `ingest:preflight`
- `lint`
- `market-snapshot:test`
- `market:snapshot`
- `migrate:local`
- `migrate:remote`
- `personal:brief`
- `prepare`
- `price:snapshot`
- `product-flow:seed:local`
- `product-flow:seed:remote`
- `requirements:test`
- `seo:test`
- `signals:auto-publish:dry`
- `signals:auto-publish:local`
- `signals:auto-publish:reapply`
- `signals:auto-publish:remote`
- `signals:auto-publish:test`
- `signals:publish-drafts:local`
- `signals:publish-drafts:remote`
- `signals:sync:local`
- `signals:sync:remote`
- `signals:test`
- `source-registry:test`
- `source:quality`
- `start`
- `storybook`
- `sync:month:local`
- `sync:month:remote`
- `task-teardowns:test`
- `test`
- `test:e2e`
- `test:e2e:ui`
- `test:watch`
- `tickers:bundle`
- `typecheck`

## Testing and Quality Signals

- `apps/web/e2e/home.spec.ts`
- `apps/web/playwright.config.ts`
- `python/ingest/tests/__init__.py`
- `python/ingest/tests/test_bluesky_source.py`
- `python/ingest/tests/test_cisa_kev_source.py`
- `python/ingest/tests/test_companies_house_source.py`
- `python/ingest/tests/test_edgar_source.py`
- `python/ingest/tests/test_equities_snapshot.py`
- `python/ingest/tests/test_equities_universe.py`
- `python/ingest/tests/test_equities_wikipedia.py`
- `python/ingest/tests/test_equities_yf.py`
- `python/ingest/tests/test_github_archive_source.py`
- `python/ingest/tests/test_gov_contracts_source.py`
- `python/ingest/tests/test_gov_source.py`
- `python/ingest/tests/test_graph.py`
- `python/ingest/tests/test_guardian_source.py`
- `python/ingest/tests/test_huggingface_source.py`
- `python/ingest/tests/test_jobs_source.py`
- `python/ingest/tests/test_lightweight_nlp.py`
- `python/ingest/tests/test_lobsters_source.py`
- `python/ingest/tests/test_macro_rates_source.py`
- `python/ingest/tests/test_markets_kalshi.py`
- `python/ingest/tests/test_metaculus_source.py`
- `python/ingest/tests/test_news_source.py`
- `python/ingest/tests/test_nvd_source.py`
- `python/ingest/tests/test_package_registries_source.py`
- `python/ingest/tests/test_patents_source.py`
- `python/ingest/tests/test_pipeline_contracts.py`
- `python/ingest/tests/test_podcast_index_source.py`
- `python/ingest/tests/test_quality.py`
- `python/ingest/tests/test_reddit_source.py`
- `python/ingest/tests/test_regulations_source.py`
- `python/ingest/tests/test_sec_xbrl_source.py`
- `python/ingest/tests/test_seed.py`
- `python/ingest/tests/test_semantic_nlp.py`
- `python/ingest/tests/test_semantic_scholar_source.py`
- `python/ingest/tests/test_source_quality.py`
- `python/ingest/tests/test_substack_source.py`
- `python/ingest/tests/test_techmeme_source.py`
- `python/ingest/tests/test_wikidata_source.py`
- `python/ingest/tests/test_youtube_source.py`
- `scripts/annotation-contract.test.ts`

## Recommendation Guidance

Good matches:
- Repos that strengthen ai agents without replacing already-installed libraries.
- Repos that strengthen cloudflare and deploy without replacing already-installed libraries.
- Repos that strengthen content and media without replacing already-installed libraries.
- Repos that strengthen analytics and intelligence without replacing already-installed libraries.
- Repos that strengthen search and discovery without replacing already-installed libraries.
- Repos that strengthen database and storage without replacing already-installed libraries.
- Repos that strengthen ui workflows without replacing already-installed libraries.
- Tools with concrete support for src, ingest, sources, python, page.tsx, brief, signal, not.
- Implementation repos, SDKs, CLIs, testing utilities, adapters, and focused libraries are higher value than generic awesome lists.

Avoid recommending:
- Do not recommend packages already listed under direct or development dependencies unless the task is migration research.
- Do not recommend broad framework replacements unless the project context explicitly calls for a rewrite.
- Downrank curated lists, archived repos, stale demos, and generic UI kits that do not map to the feature catalog.

## Evidence Read

Primary docs and handoff files:
- `PROJECT_STATUS.md`
- `README.md`
- `SPEC.md`
- `agents.md`
- `docs/README.md`
- `docs/cf-access-setup.md`
- `docs/clerk-production-setup.md`
- `docs/data-service-boundary.md`
- `docs/data-source-audit.md`
- `docs/feature-audit.md`
- `docs/high-signal-handoff.md`
- `docs/ingest-runbook.md`
- `docs/laptop-service-fleet-backup-2026-05-31.md`
- `docs/scope-reset-2026-06-03.md`
- `docs/seeding.md`
- `docs/source-coverage.md`

Package manifests:
- `apps/web/package.json`
- `package.json`
- `packages/db/package.json`
- `packages/shared/package.json`
- `workers/api/package.json`

Inventory notes:
- Files scanned: 515
- This pass uses deterministic repo inventory plus local documentation/source-path evidence. It does not claim a full manual line-by-line review of every source file.

## Confidence

Confidence: **high**

Why:
- PROJECT_STATUS.md present
- README.md present
- 42 entrypoint/runtime files identified
- package dependencies inventoried
- 42 test/quality files identified

Refresh command:

```bash
cd /Users/sarthak/Desktop/fleet/starboard
pnpm fleet:audit-recommendation-context
pnpm fleet:extract-projects
```
