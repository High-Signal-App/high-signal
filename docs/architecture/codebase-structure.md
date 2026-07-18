# Codebase structure — what lives where

High Signal is **one product** (the Daily Brief) assembled from several
intelligence domains, some of which were previously standalone products
(mentionpilot → Mentions, agentMode → Agent Eval) and consolidated into this
repo. Everything ships as one app; the domains are **lenses**, not separate
deployables (see `agents.md` locked decisions). This page is the canonical map
of which domain owns which files, so the merge stays legible.

## Deployables

| Unit | Path | Deploy |
|------|------|--------|
| Web app (Next.js) | `apps/web` | `deploy-web.yml` → CF Workers (OpenNext) |
| API (Hono) | `workers/api` | `deploy-api.yml` → CF Workers |
| Lab substrate (Python, local-first) | `python/lab` | local / ad-hoc |
| Ingestion + scoring (Python) | `python/ingest` | GitHub Actions crons |

Shared libraries (not deployed on their own): `packages/shared`, `packages/db`.

`workers/` contains only `api` — there are exactly two deploy workflows
(`deploy-web.yml`, `deploy-api.yml`). The former standalone annotation worker
was decommissioned; annotation now runs in-process via `annotateLightweightNlp`
(`packages/shared/src/nlp/annotation-client.ts`).

## Domains in `packages/shared/src`

The shared package is grouped by domain (each folder has an `index.ts` barrel;
the package root re-exports all of them, so `@high-signal/shared` imports are
domain-agnostic). Layering is acyclic: `primitives` ← `core` ←
`{nlp, ideas, content}` ← `{markets, personal}` ← `mentions`/`agent-eval`/`watchlist`.

| Folder | Owns | Origin |
|--------|------|--------|
| `primitives/` | core types, region model, signal families, generic helpers | — |
| `core/` | brief contract, product contracts, signal intelligence, claim provenance, brief delivery | core product |
| `nlp/` | lightweight NLP, annotation client | — |
| `ideas/` | business-idea / community-demand intelligence | core product |
| `markets/` | markets / equities watch | core product |
| `mentions/` | brand perception, competitor report, prompts, visibility | **mentionpilot** |
| `agent-eval/` | how AI assistants answer about a brand | **agentMode** |
| `personal/` | personal operator-intelligence (usefulness, teardowns) | personal tool |
| `watchlist/` | watchlist tracking + impact | — |
| `content/` | seed/demo content (stocks, ideas, trends, seed products) | demo fallback |

## Where each domain surfaces

- **Worker routes** (`workers/api/src/routes`): `brief`, `signals`, `entities`,
  `track-record`, `sectors`, `markets`, `communities`, `convergence`,
  `watchlists`, `claims`, `enrich`, `attention`, `delivery`, `digest`, `admin`,
  `unmapped`, `company-universe`, `d2c`, `learning`, `data`, and `products`
  (bundles `mentions`, `agent-eval`, `communities`, `dashboard`, `badge`
  surfaces).
- **Web routes** (`apps/web/src/app`): one route group per lens under the app
  shell; signals is the homepage (`/`). `PrimaryNav`
  (`apps/web/src/components/system/PrimaryNav.tsx`) exposes primary items
  `data` / `signals` / `history` / `evals`, plus secondary items `explore` /
  `settings`. Each item matches a family of routes (e.g. `data` covers
  entities / convergence / markets / equities / communities / unmapped;
  `evals` covers agent-eval / mentions / domains).

## The `personal` subsystem (operator-private tool)

This is the one domain that is genuinely a *different product* (an operator's
private intelligence brief), kept in-repo but boundaried:

- **Logic**: `packages/shared/src/personal/`
- **Generator**: `scripts/personal-command-brief.ts` (run via `pnpm personal:brief`)
- **UI**: `apps/web/src/app/personal/page.tsx`
- **State**: `data/personal-*.{json,jsonl}` (inputs + snapshots, git-tracked
  on purpose — read at build/runtime) and `reports/personal/*.md` (generated
  daily reports).

It depends on `apps/web/src/lib/daily-intelligence` and `@high-signal/shared`;
nothing in the public product depends back on it except the `/personal` route.

## Related docs

- Product direction + locked decisions: `agents.md`, `SPEC.md`
- High-level status ledger: `PROJECT_STATUS.md`
- Consolidation history: `plans/0004-platform-consolidation.md`,
  `plans/0005-legacy-extraction-ledger.md`
- Latest cleanup pass: `docs/knowledge/retros/2026-06-19-codebase-cleanup.md`
