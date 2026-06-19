# Codebase cleanup pass — 2026-06-19

Scope (set by operator): structural cleanup, **no** git-history rewrite, subapps
**only if clearly warranted**. Follow-up directive: the repo is several merged
products — keep them all in-project but **structure them better** (do not extract
to separate packages/repos).

## Restructure: group `packages/shared` by domain (follow-up)

`packages/shared/src` was 22 flat modules mixing 10+ domains. Regrouped into
domain subfolders (`primitives`, `core`, `nlp`, `ideas`, `markets`, `mentions`,
`agent-eval`, `personal`, `watchlist`, `content`), each with an `index.ts`
barrel; the package root re-exports all barrels so **every `@high-signal/shared`
import is unchanged** (verified: no external file imports deep/relative paths
into `src`). Internal relative imports rewired along the acyclic layering.
Inline core types moved to `primitives/types.ts`. `git mv` used throughout to
preserve history. `pnpm typecheck` green on all 4 TS workspaces; shared/worker
vitest + claim-provenance/brief-delivery/watchlist-impact/openlens/seo suites
pass. The `personal` operator-tool subsystem is now a single shared domain;
its full cross-repo boundary is documented in `docs/codebase-structure.md`
(the new canonical module/ownership map). No deployable topology change.

## What changed

- **Untracked agent-runtime artifacts.** `.omx/` (12 session-log/state files) was committed to
  git but referenced nowhere in product code. Removed from the index (`git rm --cached`) and
  added `.omx/`, `.symphony/`, `.clawpatch/` to `.gitignore` so local agent tooling never lands
  in commits again. Working copies are untouched.
- **Consolidated three verbatim-duplicated helpers** into `packages/shared/src/helpers.ts`
  (exported via the package index):
  - `hoursSince` — was copied in `apps/web/src/lib/{daily-intelligence,market-watch}.ts`.
  - `countBy<T>` — was copied in `apps/web/src/lib/{daily-intelligence,daily-range,market-watch}.ts`.
  - `addDays` — was copied in `apps/web/src/lib/daily-range.ts` and `scripts/seed-daily-source-history.ts`.

  All call sites now import from `@high-signal/shared`. `pnpm typecheck` passes across all four
  TS workspaces; `daily-range`, `market-snapshot`, `source-registry` tests and the shared/worker
  vitest suites pass (the 7 pre-existing `cloudflare:email` suite-load failures are unrelated and
  reproduce with these changes stashed).

## Decisions

- **No new subapps / package extraction.** The monorepo is already cleanly factored: one Next.js
  app (`apps/web`), one Hono worker (`workers/api`), a Python annotation service
  (`workers/annotation`), and `packages/{shared,db}` for cross-cutting code. The 82 web routes are
  cohesive around one product (the Daily Brief + lenses). Splitting public vs. authenticated app
  would add deploy surface with no real benefit — auth is already enforced per-route via Clerk.
  Cross-cutting logic belongs in `packages/shared`, which this pass reinforced.
- **`data/` left tracked on purpose.** Despite being ~14MB of generated JSONL/JSON snapshots, the
  web app reads `data/*` at build/runtime (`apps/web/src/lib/{equities,daily-intelligence,
  market-watch,site,price-context}.ts` and several pages). These are deliberate committed build
  inputs, not stray artifacts. Same for `reports/` (read by scripts).

## Deferred (not done — judged out of scope or too risky for a cleanup pass)

- **`latestRefreshRecords` / `acceptedRefreshRecords` dedup** between `daily-intelligence.ts` and
  `personal-command-brief.ts` — HIGH risk: the two implementations diverge in key construction,
  sorting, and gate function. Merging naively would silently change hit-detection. Needs a
  parametrized helper (inject key-builder + gate), with before/after verification.
- **`ProductFlowRefreshRecord` type** declared as divergent supersets across 4 files. Consolidate
  to a shared base + variants when someone unifies the product-flow path.
- **`parseJsonl` skeleton** repeated across ~5 build scripts with per-script row predicates. Low
  value while they stay isolated build scripts.
- Note: `countBy` in `personal-command-brief.ts` (returns `Record`) and `source-registry.test.ts`
  (returns `Map`) are **not** duplicates of the shared `{k,n}[]` version — left as-is.
