# agents.md — high-signal

> Concise agent bootloader. Deep detail lives in [`docs/`](docs/) — see
> [`docs/index.md`](docs/index.md) for the full map. Day-to-day status:
> [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (current/shipped product truth).
> Full product spec: [`SPEC.md`](SPEC.md); open work lives in GitHub Issues.

## Repository operating rules

This repository is independently operable. Its tracked instructions and
commands are authoritative; no sibling Fleet checkout is required. Protect
production stability, keep changes scoped, verify work with repo-local checks,
and record durable follow-up in this repository's GitHub Issues.

Before broad product or architecture work, read [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
Update it when durable current/shipped truth changes. Track planned, deferred,
and blocked work in GitHub Issues.

## Purpose

**High Signal is one product: a daily synthesized brief.** It aggregates noisy
public sources (Reddit, news, Hacker News, YouTube transcripts, SEC filings,
GitHub, IR pages, etc.), curates and cleans them, and emits an end-of-day
message answering five questions for the operator. Everything else — Markets,
Communities, Agent Eval, Lab — is an **intelligence helper** feeding that
brief, not a standalone product. There are no user accounts: everything
readable is public, and the only gate is a single operator session that
controls publishing.

Locked product direction (brand, sections, pricing, lenses, hard rules, UI
direction, out-of-scope): [`docs/product/direction.md`](docs/product/direction.md).
That file is the authoritative product-direction snapshot and supersedes the
prior "umbrella + 5 sub-products" framing in `plans/0004-platform-consolidation.md`.

## Stack

- **Web**: Next.js 16 (App Router, Turbopack) — `apps/web`
- **API**: Hono on Cloudflare Workers — `workers/api`
- **DB**: Cloudflare D1 + Drizzle — schema in `packages/db`
- **Lab substrate**: local-first Postgres (FTS + `pgvector`) — `python/lab` (plan `0007`, parked)
- **Python ingestion + scoring**: edgartools, Trafilatura, GLiNER, NetworkX — `python/ingest`. Relation extraction (GLiREL) is a parked stub returning a typed empty result (not a declared dep); FinBERT sentiment is code-present but its `transformers` dep is undeclared and returns an unavailable/neutral-with-reason result. Daily crons on GitHub Actions; Modal kept for ad-hoc backfills only.
- **Signal store**: git-versioned markdown under `signals/YYYY-MM-DD/<slug>.md` — append-only, never rewritten.
- **Auth**: none for readers — the product is fully public. A single operator session gates publishing: password → signed httpOnly cookie (`apps/web/src/lib/admin-session.ts`), verified by `requireAdminSession()` / `hasAdminSession()` (`admin-guard.ts`). The `/api/admin` proxy injects `ADMIN_TOKEN` server-side so it never reaches the browser. Clerk and CF Access were both removed — do not reintroduce either without a migration plan (ADR-013).
- **Testing**: Vitest (TS), pytest (Python), Playwright (e2e).
- **Deploy**: Cloudflare Workers for web (`high-signal-web` via OpenNext) and API (`high-signal-api`). No Vercel.
- **Package manager**: pnpm workspace + uv (Python).

SaaS Maker package reuse/drop decisions: [`docs/architecture/saas-maker-integrations.md`](docs/architecture/saas-maker-integrations.md).

## Essential commands

```bash
pnpm install                              # Node deps
cd python/ingest && uv sync && cd -       # Python deps
pnpm dev                                  # web :3000 + api :8787
pnpm build | pnpm typecheck | pnpm lint   # build / typecheck / format-check
pnpm test                                 # all package + script test suites
pnpm db:migrate:local | pnpm db:migrate:remote
pnpm db:seed:local | pnpm db:seed:remote
pnpm signals:sync:local | pnpm signals:sync:remote
pnpm signals:auto-publish:remote          # two-tier judge (rules + AI on HOLD)
pnpm personal:brief                       # operator personal command brief
pnpm ingest:local                         # python pipeline --source all --days 1
pnpm source:diagnose                      # read-only source health (never prints secrets)
pnpm docs:check                           # internal-link check + empty-dir sanity on docs/ (no frontmatter validation)
pnpm docs:blume:dev                       # local Blume dev server (presentation only)
```

Full command list and setup walkthrough: [`README.md`](README.md) Quickstart.
Cron job intent + ordering: [`docs/operations/jobs.md`](docs/operations/jobs.md).

## Architecture pillars

- **Evidence-first** — no signal ships without ≥ 2 cited sources.
- **Spillover map** — event → direct impact → 2nd-order entities via supplier/customer/peer edges.
- **Versioned signal memory** — signal log is git; corrections are new signals citing prior (ADR-002).
- **Confidence as a band** — `low` / `medium` / `high`, calibrated post-hoc against hit-rate.
- **Public hit-rate ledger from day 1** — the moat.
- **Auto-publish, no human gate** — daily `cron-publish.yml` runs `scripts/auto-publish-drafts.ts` at 07:00 UTC. Two-tier judge: deterministic rubric (`scripts/auto-publish-rules.ts`, unit-tested) → AI judge on HOLD only → HOLD biases to KILL without AI. PUBLISH → `review_status='published'`; KILL → `review_status='killed'` (reversible via `/review`). Full rules in [`docs/architecture/decisions.md`](docs/architecture/decisions.md) ADR-008.
- **World change → product opportunity** — major changes and repeated app complaints become concrete product ideas.
- **Human attention + agent evaluation** — short-form content earns consideration; structured evidence earns recommendation.

Architecture decisions (ADRs): [`docs/architecture/decisions.md`](docs/architecture/decisions.md).
Codebase structure / domain ownership map: [`docs/architecture/codebase-structure.md`](docs/architecture/codebase-structure.md).
Data service boundary: [`docs/architecture/data-service-boundary.md`](docs/architecture/data-service-boundary.md).

## Quality gates

- Cite or kill — minimum 2 sources per signal.
- No retroactive edits — corrections via new commits citing the prior signal.
- Spillover edges flagged `unverified` until reviewed once.
- Per-source hit-rate logged; cull underperformers.
- Weekly self-audit: signals shipped, hit-rate by type, sources broken, entities missed.

## Critical constraints (do not violate)

- **No second stock-price ingress.** All public equity/ETF/index/crypto EOD prices enter through the single yfinance snapshot path (`python/ingest/.../equities_daily.py` → `data/equities-snapshot.jsonl`). Consume the artifact or D1 `closes` / `ticker_snapshot` — never add a parallel fetcher.
- **Prediction markets are not equity prices.** `market_quotes` = Polymarket/Manifold/Kalshi probabilities (schema enum; `cron-markets.yml` runs `--source markets`). Metaculus is a separate forecast/events source, not a `market_quotes` row. Never use that table as equity-price evidence. Auto-publish KILLs prediction-market-only signals.
- **Signals are append-only.** Never edit a published signal markdown; supersede with a new file citing the prior.
- **No secrets in the repo.** No `.env`, keys, or production configs in commits. Cron secrets live in GitHub Actions secrets / Infisical.
- **No user accounts.** Per-user features (Mentions, Watchlists, email brief delivery, saved Agent Eval history) were deleted in migration `0020` — see ADR-013. Do not add a per-user table, a login for readers, or a second auth vendor without a new ADR.
- **`tracked_communities` is operator curation, not user data.** Its `owner_id` column is vestigial. The public brief's Behavior & Culture section reads its digests, so its CRUD lives behind `ADMIN_TOKEN` in `workers/api/src/routes/admin.ts` — never re-scope it per user or delete it.
- **Free AI first.** Prefer the `free-ai` gateway / local models / free tiers; escalate to paid models only when justified.

## Documentation navigation

| Need | Read |
| --- | --- |
| Full docs map + maintenance rules | [`docs/index.md`](docs/index.md) |
| Locked product direction, UI, out-of-scope | [`docs/product/direction.md`](docs/product/direction.md) |
| Scope reset (active vs parked) | [`docs/product/scope-reset.md`](docs/product/scope-reset.md) |
| Feature audit | [`docs/product/feature-audit.md`](docs/product/feature-audit.md) |
| Commercial handoff | [`docs/product/handoff.md`](docs/product/handoff.md) |
| Architecture decisions (ADRs) | [`docs/architecture/decisions.md`](docs/architecture/decisions.md) |
| Codebase / domain ownership | [`docs/architecture/codebase-structure.md`](docs/architecture/codebase-structure.md) |
| Data service boundary | [`docs/architecture/data-service-boundary.md`](docs/architecture/data-service-boundary.md) |
| SaaS Maker integrations | [`docs/architecture/saas-maker-integrations.md`](docs/architecture/saas-maker-integrations.md) |
| Seeding | [`docs/development/seeding.md`](docs/development/seeding.md) |
| Source catalog (regenerated from code) | [`docs/operations/source-catalog.md`](docs/operations/source-catalog.md) |
| Source coverage / launch scope | [`docs/operations/source-coverage.md`](docs/operations/source-coverage.md) |
| Data source audit | [`docs/operations/data-source-audit.md`](docs/operations/data-source-audit.md) |
| Cron jobs reference | [`docs/operations/jobs.md`](docs/operations/jobs.md) |
| Ingest runbook | [`docs/operations/runbooks/ingest.md`](docs/operations/runbooks/ingest.md) |
| Operator admin access | [`docs/operations/runbooks/admin-access.md`](docs/operations/runbooks/admin-access.md) |
| Durable learnings | [`docs/knowledge/learnings/lessons.md`](docs/knowledge/learnings/lessons.md) |
| Failed & deferred approaches | [`docs/knowledge/failed-approaches.md`](docs/knowledge/failed-approaches.md) |
| External references (papers/libs) | [`docs/knowledge/external-references.md`](docs/knowledge/external-references.md) |
| Phase retrospectives | [`docs/knowledge/retros/`](docs/knowledge/retros/) |
| Active plans | [`plans/`](plans/) |
| Research notes | [`research/`](research/) |

## Documentation maintenance rules

1. **Markdown in `docs/` is the source of truth.** Blume (`blume.config.ts`) and the website are presentation only.
2. **One canonical home per fact.** Link, don't re-explain. When consolidating, preserve the old page under `docs/archive/` (keeps git rename history).
3. **Code is authoritative for implementation detail and schedules** (exact cron expressions, env var lists, schema columns). Document *why*, non-obvious constraints, procedures, decisions, and reusable failures.
4. **Mark unresolved questions explicitly** (`TBD:`, `Unresolved:`) — see ADRs for the convention.
5. **No empty folders or placeholder pages.**
6. **Use `git mv`** when moving docs, and update cross-references in the same change. Run `pnpm docs:check` before committing.
7. **ADRs are append-only** — supersede with a new ADR referencing the prior.
8. **Keep `agents.md` concise** — link to `docs/` for depth. Don't grow product detail back into this file.

<!-- FLEET-GUIDANCE:START -->

## Fleet Guidance

### Adding Tasks
- Track High Signal work in this repository's GitHub issues or OpenSpec changes.
- Keep reusable cross-project automation in Workflows and Skills and private
  portfolio metadata in Site Health, not SaaS Maker.

### Using SaaS Maker
- Do not use the retired SaaS Maker task queue or API as a system of record.
- Site Health owns private portfolio metadata; Workflows and Skills owns shared
  automation. High Signal remains independently versioned and deployed.

### Free AI First
- Prefer free/local AI paths for routine development and analysis: the `free-ai` gateway, local models, provider free tiers, and cached context.
- Escalate to paid models only when complexity, correctness risk, or missing capability justifies the cost.
- Note any paid-AI use in the task or handoff when it materially affects cost, reproducibility, or future maintenance.

<!-- FLEET-GUIDANCE:END -->
