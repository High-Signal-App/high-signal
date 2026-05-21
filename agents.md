# agents.md — high-signal

## Shared Fleet Standard

Also read and follow the shared fleet-level agent standard at `../AGENTS.md`. Treat this repository as owned product code: protect production stability, keep changes scoped, verify work, and record durable follow-up tasks when something remains incomplete or blocked.

## Purpose
**High Signal is the umbrella product for extracting actionable signals from noisy public and semi-public information streams.** The current AI-infra / semiconductors signal log remains the first Market Intelligence collection, but it is no longer the whole product direction.

Full product brief: `SPEC.md`. Active top-level build plan: `plans/0004-platform-consolidation.md`. Agent evaluation plan: `plans/0006-agent-evaluation-attention-layer.md`. Market artifact plan: `plans/0001-research-artifact-first.md`.

## Locked decisions
- **Umbrella brand**: High Signal
- **Sub-products**: Mention Intelligence, Community Intelligence, Market Intelligence, Agent Evaluation Intelligence
- **Migration sources**: Mention Intelligence from `/Users/sarthakagrawal/Desktop/Fleet/mentionpilot`; Community Intelligence from `/Users/sarthakagrawal/Desktop/Fleet/agentMode`
- **First Market Intelligence wedge**: AI infra / semiconductors
- **Market scope**: high-level national and international stock/sector watch; no deep single-stock research until the signal pipeline is mature
- **Product opportunity scope**: High Signal should proactively say what products need to be built because world-level changes, smaller app requirements, and common complaint clusters create new demand
- **First Agent Evaluation wedge**: agent-readiness audits for startups/SaaS/products, paired with evidence-backed reel briefs that translate the audit into human attention hooks
- **Market horizon**: weekly digest + on-event signal cards
- **Market output channels**: public web page + RSS + Twitter thread per signal + weekly Substack digest
- **Codename**: `high-signal` (rebrand TBD post-traction; collision with High Signal Labs / HQ)

## Considered and deferred
- **Multi-collection engine for EverythingRated** (2026-04-26) — design archived at `plans/0003-multi-collection-for-everythingrated.md`. Not shipped; reopening trigger is in that file. Engine remains single-collection and AI-infra-only.

## Consolidation rule
Do not delete or archive `mentionpilot` or `agentMode` until the relevant features have been migrated into this repo and verified. Treat those repos as read-only migration sources. Do not copy entire directories wholesale; port the useful domain behavior into High Signal's app shell, schema, API, and ingest boundaries.

## Stack
- **Web**: Next.js 16 (App Router, Turbopack) — `apps/web`
- **API**: Hono on Cloudflare Workers — `workers/api`
- **DB**: Cloudflare D1 + Drizzle — schema in `packages/db`
- **Python ingestion + scoring**: edgartools, Trafilatura, GLiNER, GLiREL, NetworkX, FinBERT, VectorBT — runs on Modal.com — `python/ingest`
- **Signal store**: git-versioned markdown under `signals/YYYY-MM-DD/<slug>.md` — append-only, never rewritten
- **Auth**: Cloudflare Access (Google IdP via Zero Trust) — fronts `/review` and `/api/admin/*`. Server verifies the `Cf-Access-Jwt-Assertion` JWT against the team JWKS (`apps/web/src/lib/cf-access.ts`). No NextAuth, no `AUTH_SECRET`. Setup is dashboard-only; only env vars are `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`.
- **Testing**: Vitest (TS), pytest (Python), Playwright (e2e)
- **Deploy**: Vercel (web) + Cloudflare Workers (API + cron) + Modal (ingest)
- **Package manager**: pnpm workspace + uv (Python)

## Planned repo structure
```
apps/
  web/                 # Next.js — High Signal app shell, sub-products, signal feed, review queue
packages/
  db/                  # Drizzle schema (entities, events, signals, evidence, relationships, score_runs)
  shared/              # Types shared by web + workers
  signal-engine/       # Add only when at least two sub-products share real extraction/scoring logic
workers/
  api/                 # Hono — REST/RPC for web app + cron triggering Modal jobs
python/
  ingest/              # Source adapters, entity/relation extraction, signal generator
    sources/           # edgar.py, news.py, reddit.py, ir.py, ...
    extract/           # gliner_ner.py, glirel_relations.py
    score/             # finbert_sentiment.py, backtest.py
    seed/              # ai_infra_entities.csv, relationships.csv
signals/               # git-versioned signal markdown files (append-only)
plans/                 # Active plans (archive prior versions in plans/archive/)
research/              # Domain notes, source experiments, prompt drafts, market research
```

## Architecture pillars
- **Evidence-first** — no signal ships without ≥ 2 cited sources
- **Spillover map** — event → direct impact → 2nd-order entities via supplier/customer/peer edges
- **Versioned signal memory** — signal log is git; corrections are new signals citing prior
- **Confidence as a band** — `low` / `medium` / `high`, calibrated post-hoc against hit-rate
- **Public hit-rate ledger from day 1** — moat that competitors can't copy without rebuilding
- **Manual review queue** — first 4 weeks, every signal + every new graph edge gates through human review
- **World change → product opportunity** — major changes and repeated app complaints should become concrete product ideas with target user, why-now, evidence, and next validation step
- **Human attention + agent evaluation** — short-form content earns consideration; structured evidence earns recommendation

## UI direction (locked)
**Futurist + very clean.** Visual credibility = signal credibility.
- Dark default. Monochrome zinc base. One accent (cyan-400) only on directional signals.
- Geist Sans + Geist Mono. Tabular numerals on every metric.
- 1px lines, no shadows, no rounded-3xl. Whitespace generous.
- Reference points: Linear, Vercel admin, Stripe Atlas, Bloomberg terminal, Perplexity detail views.
- Animations only on state change (signal published, hit-rate update). No decorative motion.

## saas-maker integrations
Reuse user's `@saas-maker/*` packages instead of rebuilding:
- `@saas-maker/ai` — AI provider in web + worker (signal generation, summarization)
- `@saas-maker/ops` — worker observability
- `@saas-maker/foundry-db` — D1/Drizzle helpers in worker
- `@saas-maker/foundry-email` — weekly digest email
- `@saas-maker/analytics-sdk` — usage events on web
- `@saas-maker/feedback-widget` — feedback on every signal card
- `@saas-maker/waitlist-widget` — pre-launch landing
- `@saas-maker/{eslint,prettier,tsconfig}-config` — shared tooling

## Quality gates
- Cite or kill — minimum 2 sources per signal
- No retroactive edits — corrections via new commits citing the prior signal
- Spillover edges flagged `unverified` until reviewed once
- Per-source hit-rate logged; cull underperformers
- Weekly self-audit: signals shipped, hit-rate by type, sources broken, entities missed

## Out of scope (resist)
- Multi-wedge expansion before hit-rate is real
- Agent UI / chat-over-docs (saturated by AlphaSense, Brightwave, Hebbia)
- Generic reel generation without evidence, positioning, or agent-readiness scoring
- Licensed datasets (premature)
- Vector retrieval (defer until evidence search is the bottleneck)
- Paid SaaS, billing, multi-tenancy
- Mobile app, Discord/Slack alerts (RSS + email + Twitter is enough)

<!-- FLEET-GUIDANCE:START -->

## Fleet Guidance

### Adding Tasks
- Add durable work items in SaaS Maker Cockpit Tasks when the task affects product behavior, deployment, user feedback, or fleet maintenance.
- Include the project slug, a concise title, acceptance criteria, priority/status, and links to relevant code, issues, traces, or dashboards.
- If task discovery starts locally in an editor or agent session, mirror the durable next step back into SaaS Maker before handoff.

### Using SaaS Maker
- Treat SaaS Maker as the system of record for project metadata, feedback, tasks, analytics, testimonials, changelog, and fleet visibility.
- Prefer API-first workflows through `fnd api`, the SDK, or widgets instead of one-off scripts when interacting with SaaS Maker features.
- Keep this agent file aligned with the project record when operating rules, integrations, or deployment conventions change.

### Free AI First
- Prefer free/local AI paths for routine development and analysis: the `free-ai` gateway, local models, provider free tiers, and cached context.
- Escalate to paid models only when complexity, correctness risk, or missing capability justifies the cost.
- Note any paid-AI use in the task or handoff when it materially affects cost, reproducibility, or future maintenance.

<!-- FLEET-GUIDANCE:END -->

## Active context

### Built (2026-04-25)
- **Monorepo scaffolded** — pnpm workspace, web + api + db + shared, plus `python/ingest`
- **Drizzle schema + 0000 migration** — entities, relationships, events, signals, evidence, score_runs
- **Seed data** in `python/ingest/src/high_signal_ingest/seed/`:
  - `ai_infra_entities.csv` — 274 entities across the full AI-infra stack
  - `relationships.csv` — 175 curated supplier/customer/peer/partner edges with citations
  - `signal_types.yaml` — 31 signal types with extraction patterns + windows + spillover hints
  - `sources.yaml` — 168 sources (74 tier-1) across IR, news, blogs, SEC, Reddit, X, GitHub, conferences, gov
- **Python ingest pipeline** — `sources/{edgar,news,reddit,ir}.py`, `extract/entities.py` (gazetteer + GLiNER), `score/{sentiment,backtest}.py`, `generator.py` (LLM signal drafter), `writer.py` (markdown to `signals/`), `pipeline.py` (orchestrator)
- **Modal deploy** — `modal_app.py` with daily cron @ 06:00 UTC
- **Worker API (Hono on CF Workers)** — routes: `/signals`, `/signals/:slug`, `/signals/by-entity/:id`, `/entities`, `/entities/:id`, `/track-record`, `/track-record/series`, `/digest/weekly`, `/digest/rss`; cron handler triggers Modal
- **Web app (Next.js 16, Tailwind v4, futurist UI)** — pages: `/`, `/signals`, `/signals/[slug]`, `/entities`, `/entities/[id]`, `/track-record`, `/digest`, OG image route, 404
- **Components** — `DirectionPill`, `ConfidenceBadge`, `SignalCard` atoms+molecules
- **Scripts** — `scripts/seed-d1.ts` (CSV → D1), `scripts/sync-signals.ts` (markdown → D1)

### Next concrete actions for user
1. `pnpm install` at repo root
2. `cd python/ingest && uv sync`
3. `wrangler d1 create high-signal-db` → paste id into `workers/api/wrangler.toml`
4. `pnpm db:migrate:local && pnpm db:seed:local`
5. Set env: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `SEC_USER_AGENT` (Modal Secret named `high-signal`)
6. `pnpm dev` — runs web + worker
7. `cd python/ingest && uv run python -m high_signal_ingest.pipeline --source news --days 1` to draft first signals into `signals/draft/`
8. Manual review: open drafts → flip frontmatter `review_status: published` → commit → `pnpm signals:sync:local`


<claude-mem-context>
# Memory Context

# [high-signal] recent context, 2026-04-25 8:52pm GMT+5:30

No previous sessions found.
</claude-mem-context>
