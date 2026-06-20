# agents.md — high-signal

## Shared Fleet Standard

Also read and follow the shared fleet-level agent standard at `../AGENTS.md`. Treat this repository as owned product code: protect production stability, keep changes scoped, verify work, and record durable follow-up tasks when something remains incomplete or blocked.

Before broad product or architecture work, read `PROJECT_STATUS.md`. It is the single high-level status ledger for what is done, planned next, and deferred/parked in this project. Update it whenever active scope, shipped features, planned work, or deferred work changes.

## Purpose
**High Signal is one product: a daily synthesized brief.** It aggregates noisy public sources (Reddit, news, Hacker News, YouTube transcripts, SEC filings, GitHub, IR pages, etc.), curates and cleans them, and emits an end-of-day message answering five questions for the operator. Everything else in this repo — Markets, Communities, Mentions, Agent Eval, Lab — is an **intelligence helper** feeding that brief, not a standalone product.

Full product brief: `SPEC.md`. Locked product direction below supersedes the prior "umbrella + 5 sub-products" framing in `plans/0004-platform-consolidation.md`.

## Locked decisions (product direction, 2026-05-25)

- **Brand**: High Signal.
- **Core product**: one **Daily Brief** per user per day, generated end-of-day from the helpers below. The brief is the homepage for signed-in users.
- **Knowledge domains** the brief covers — three, no more:
  1. **Technology** — what's launching, breaking, gaining adoption, getting deprecated.
  2. **Startups** — what's being built, funded, killed; demand signals from communities.
  3. **Finance** — what's worth watching in markets, sector moves, macro shifts that affect the above.
- **Pricing**: everything is free for now. No paid tier, no billing, no Clerk metadata gates. Region is a free filter, not a paywall. Revisit once usage proves a willingness-to-pay surface.
- **Public default feed** (the homepage for any visitor, signed in or not) — **3 sections**:
  1. **Stocks watching for a boom** — finance × technology overlap. Every claim shows the project's prior **hit-rate** on that signal type inline (the moat).
  2. **Business ideas to build** — startups × community-demand signals.
  3. **New lifestyle trends** — community + cultural shifts surfaced from forums and transcripts.
- **Two more sections appear after a brand is connected**:
  4. **How the market perceives your products** — mention intelligence over the connected brand.
  5. **Ideas to improve your products** — agent-evaluation gaps for the connected brand.
- **Region**: free filter on every section. Default = global. Users can switch to any region; brief recomputes scoped to that region's entities + sources. Preference persists via Clerk `publicMetadata.region` for signed-in users.
- **Helpers / lenses (engine room, not destinations)**:
  - **Markets lens** feeds section 1. The AI-infra / semiconductors signal pipeline + public hit-rate ledger remain the proof-of-quality.
  - **Communities lens** feeds sections 2 and 3 — pain, demand, narrative, lifestyle drift.
  - **Mentions lens** feeds section 4 — requires the user to connect a brand.
  - **Agent Eval lens** feeds section 5 — requires the user to connect a brand.
  - **Lab substrate** (plan `0007`) is the local-first ingestion + index layer underneath all of them.
  - Surfaced under `/lenses/*` so the word "products" in the UI stays unambiguously about the user's brand, not about our intelligence surfaces.
- **Sources**: infinite by design. Reddit, news, HN, YouTube transcripts, SEC filings, GitHub, IR pages, papers, government feeds, prediction markets. The job is **curation + cleaning + de-duplication**, not aggregation volume.
- **Hard rules baked in** (carry forward from the prior frame):
  - Cite or kill — every claim in the brief points at ≥ 2 sources.
  - Memory is git-versioned markdown; corrections are new entries citing prior, never edits.
  - Public hit-rate ledger from day 1 — the moat.
  - Confidence as a band: low / medium / high, calibrated post-hoc.
- **Codename**: `high-signal` (rebrand TBD post-traction).

## Considered and deferred
- **Multi-collection engine for EverythingRated** (2026-04-26) — design archived at `plans/0003-multi-collection-for-everythingrated.md`. Not shipped; reopening trigger is in that file.
- **Per-platform fan-out for Mentions/Agent-Eval** (Claude / ChatGPT / Perplexity / Gemini as distinct provider creds). Today both use one OpenAI-compatible endpoint and tag everything `platform: 'custom'`. Reopen if users demand per-platform breakdowns.
- **Paid tiers / region gating** — explicitly out of scope (2026-05-25). Everything is free; region is a free filter. Revisit when usage proves willingness-to-pay.

## Consolidation rule
Do not delete or archive `mentionpilot` or `agentMode` until the relevant features have been migrated into this repo and verified. Treat those repos as read-only migration sources. Do not copy entire directories wholesale; port the useful domain behavior into High Signal's app shell, schema, API, and ingest boundaries.

## Stack
- **Web**: Next.js 16 (App Router, Turbopack) — `apps/web`
- **API**: Hono on Cloudflare Workers — `workers/api`
- **DB**: Cloudflare D1 + Drizzle — schema in `packages/db`
- **Lab substrate**: local-first Postgres (FTS + `pgvector`) for HighSignal Lab ingestion/index — separate from the D1 signal store — `python/lab` (plan `0007`)
- **Python ingestion + scoring**: edgartools, Trafilatura, GLiNER, GLiREL, NetworkX, FinBERT, VectorBT — `python/ingest`. **Daily crons run on GitHub Actions** (`.github/workflows/cron-{ingest,markets,score}.yml`); Modal (`python/ingest/modal_app.py`) is kept only for ad-hoc backfills via `modal run`.
- **Signal store**: git-versioned markdown under `signals/YYYY-MM-DD/<slug>.md` — append-only, never rewritten
- **Auth**: Clerk (Google + email) — `ClerkProvider` wraps the app shell; `AuthNav` renders sign-in / sign-up / user button. Server-side gates use `requireSignedIn()` (`apps/web/src/lib/require-auth.ts`) and `requireAdmin()` (`apps/web/src/lib/clerk-admin.ts`, allow-list via `ADMIN_ALLOWED_EMAILS`). Env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ADMIN_ALLOWED_EMAILS`. The earlier Cloudflare Access plan was abandoned; do not reintroduce it without a migration plan.
- **Testing**: Vitest (TS), pytest (Python), Playwright (e2e)
- **Deploy**: Cloudflare Workers for both web (`high-signal-web` via OpenNext) and API (`high-signal-api`). Daily crons on GitHub Actions. Modal kept for ad-hoc backfills only. No Vercel.
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
- **Auto-publish, no human gate** — Sarthak's 2026-05-26 directive: "I don't want it blocked by me." A daily `cron-publish.yml` workflow runs `scripts/auto-publish-drafts.ts` at 07:00 UTC. Two-tier judge:
  1. Deterministic rubric (in `scripts/auto-publish-rules.ts`, unit-tested by `scripts/auto-publish-rules.test.ts`):
     - `< 2` evidence URLs → KILL (cite-or-kill floor)
     - prediction-market-only (manifold / polymarket / kalshi / metaculus alone, or `sourceClasses=['market']`) → KILL even if pipeline marked `publishable=true` (markets reflect crowd opinion, not new information)
     - `publishable=true` AND `independentSourceCount >= 2` → PUBLISH (strongest case)
     - `fallback_or_backfill` quality reason → KILL (pipeline already flagged low confidence)
     - `publishable=true` but thin corroboration → HOLD (escalate to AI)
     - corroboration but pipeline held back → HOLD (escalate to AI)
     - otherwise → KILL
  2. AI judge (DeepSeek default, any OpenAI-compatible) fires only on HOLD.
  3. Without AI available, biases HOLD → KILL so the queue stays clear.
  Verdict effects: PUBLISH → `review_status='published'`; KILL → `review_status='killed'` (new fourth status, reversible via `/review`; the brief never reads from it). The `/review` page remains accessible as an override surface but is not on the daily critical path.
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
- AI provider — calls the `free-ai` gateway directly via `workers/api/src/lib/ai-client.ts` (no `@saas-maker/ai` package; signal generation, summarization)
- DB — own `@high-signal/db` workspace package (Drizzle on Cloudflare D1, schema in `packages/db/src/schema.ts`); no shared SaaS Maker DB package (dropped the unused `@saas-maker/foundry-db` / `@saas-maker/ops`)
- Observability — PostHog directly (no `@saas-maker/ops`)
- Email — `cloudflare:email` binding (`workers/api/src/lib/email.ts`); no SaaS Maker email package
- Analytics — PostHog directly (`apps/web/src/lib/foundry-monitoring.ts`); no SaaS Maker analytics package
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
- Vector retrieval in the public signal product surface (defer until evidence search is the bottleneck) — the HighSignal Lab substrate (plan `0007`) does use `pgvector` internally; keep vector search inside Lab
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

### Built (2026-04-25 → 2026-05-25)

**Original scaffold (2026-04-25)**
- **Monorepo** — pnpm workspace, web + api + db + shared, plus `python/ingest`.
- **Drizzle schema + migrations 0000–0004** — entities, relationships, events, signals, evidence, score_runs, mention configs/prompts/checks/results, tracked communities + digests, agent evaluation audits/responses/scores/tasks/reel briefs, market quotes.
- **Seed data** (`python/ingest/src/high_signal_ingest/seed/`) — 274 entities, 175 relationships, 31 signal types, 168 sources.
- **Python ingest pipeline** (10 adapters: edgar / news / reddit / ir / github / gov / youtube / gdelt / hkex / markets) → markdown drafts → `signals/`.
- **Modal deploy** with daily cron @ 06:00 UTC.
- **Worker API (Hono / CF Workers)** — `signals`, `entities`, `track-record` (cohorts + workbench), `sectors`, `digest/{weekly,rss,atom}`, `communities/reddit/*`, `products/{dashboard,agent-eval,mentions,communities,badge}`, admin sync.
- **Web app (Next.js 16, Tailwind v4)** — full IA across signals, entities, sectors, markets, track-record, daily, dashboard, opportunities, ideas, teardowns, watchlist, personal, digest, embed/.
- **Auth via Clerk** — sign-in / sign-up modal, `AuthNav`, `requireSignedIn`, `requireAdmin` allow-list.

**Daily Brief surface added (2026-05-25)**
- **Direction reframe** — the product is now **one** Daily Brief, not five sub-products. The five sub-products were demoted to **lenses** that feed the brief.
- **Public demo model (no signup required)** — Sarthak's 2026-05-25 directive: "30-40 products and 5-7 regions, we can just test those out." `packages/shared/src/seed-products.ts` ships 35 hand-crafted brands across tech / startups / finance. The brief always renders all 5 sections: personal sections (4+5) prefer real D1 owner data first, then an explicit `product=<id>` selection, then a rotating hourly spotlight from the seed pool. Anonymous and signed-in look identical until a real brand is connected.
- **Seed-content fallback for public sections** — `packages/shared/src/seed-content.ts` ships **35 stock signals across 7 regions** (with realistic hit-rate samples), **20 business ideas**, and **18 lifestyle trends**. Every demo region surfaces ≥ 4 stocks, ≥ 6 ideas, and ≥ 5 trends as fallback. Real data always wins when present. Verified end-to-end via `wrangler dev` + curl on 2026-05-25.
- **Hit-rate family fallback** — `packages/shared/src/signal-families.ts` maps signal types to 8 families (supply-demand, ai-adoption, macro-demand, capital-allocation, consumer-behavior, platform-momentum, regulatory-shift, other). `resolveHitRate()` in `workers/api/src/routes/brief.ts` uses a three-tier resolution: **direct** (≥ 3 scored predictions on the exact type) → **family** (≥ 5 across the family) → **early** (1–4 anywhere) → **none**. Fresh signal types now borrow confidence from sibling types instead of rendering silent.
- **Seed-products expanded across all 7 demo regions** — `packages/shared/src/seed-products.ts` ships 50 brands covering tech / startups / finance × NA / EU / south-asia / east-asia / SEA / latam / MENA / Africa / Oceania. Every demo region's spotlight rotation has something to pick.
- **Fault-tolerant composition** — every section builder in `workers/api/src/routes/brief.ts` is wrapped in a `safe()` helper that catches `D1_ERROR: no such table` / connection / driver errors and degrades to seed fallback. The brief surface stays live even on a deploy where D1 hasn't been migrated yet.
- **Shared contracts** — `packages/shared/src/{region,brief,seed-products}.ts` define `Region`, the country rollups, `BriefSnapshot`, `SeedProduct`, and the curated `DEMO_REGIONS` (7 surfaced in pickers).
- **Worker route** — `workers/api/src/routes/brief.ts` exposes `GET /brief/daily?region=<r>&owner=<id>&product=<seedId>`. Pulls stocks from `signals` joined to `entities` (filtered by country rollup), inline hit-rate per signal type from `score_runs`. Pulls ideas + trends from `community_digest_snapshots` `key_action` / `key_trend`. Pulls perception from `mention_checks` + `mention_results`. Pulls improvements from open `agent_evidence_tasks`. **Window is 28 days** across all signal + digest queries — Sarthak's "sync at least 4 weeks of data everywhere."
- **Web surface** — `/brief` page and `/` (homepage) render the brief via `BriefSections` + `RegionPicker` + `ProductPicker`. Picker changes recompose the brief via URL params, no JS reload needed.
- **Primary nav reframe** — `apps/web/src/components/system/PrimaryNav.tsx` leads with **brief / track record**, then a `lenses:` label followed by markets / communities / mentions / agent eval / lab, with review pushed to the right.
- **`/opportunities` and `/ideas`** — still accessible as deep views but no longer in primary nav. The brief's Ideas section links to `/opportunities` as a "deeper view".
- **`/review/lab-candidates`** — closes the Lab → curation loop. Renders top-30 Lab docs by signal score; each row offers "draft signal" which downloads a pre-filled markdown template the operator drops into `signals/<date>/`.
- **Communities** (`/communities`) — rewrote from sample-data shell to a real hub: tracked subreddits, latest digests, generate / untrack actions, public discover feed, ad-hoc lookup preview. Backend (`worker /products/communities/*`, `community-research.ts`) was already in place.
- **Mentions** (`/mentions`) — rewrote from single-text analyzer to brand configs CRUD + platform multi-select + prompts list + run check + recent check history. Local NLP preview analyzer kept as a side tool.
- **Track record** (`/track-record`) — made public (was admin-only); admin still sees raw combined ledger.
- **Agent Eval real-AI execution** — `workers/api/src/lib/agent-evaluation-execution.ts`: when `HIGH_SIGNAL_AI_API_KEY` (or `OPENAI_API_KEY`) is set, the prompt matrix hits a real LLM and responses are re-analyzed for brandMentioned / brandRecommended / competitors / citations. Falls back to deterministic synthesis without a key.
- **Lab substrate (Phase 1, expanded)** — `python/lab/`: pgvector docker-compose; schema with `cluster_id` on documents; HN ingest with outbound-link extraction; one-hop materialization (`materialize.py`); GitHub trending HTML scraper (no API key); 4-factor scorer (HN + recency + velocity + GitHub); union-find story clustering over shared link targets + embedding similarity; local sentence-transformer embeddings (384-dim, optional `[embeddings]` extra) with HNSW indexes auto-created; GLiNER entity extraction (optional `[entities]` extra); local-LLM summarization via any OpenAI-compatible endpoint (Ollama / vLLM / etc.); FastAPI exposing `/feed`, `/feed?by_cluster=true`, `/search` (semantic), `/stats`, `/healthz`. Web `/lab` surfaces cluster ids and a cluster-collapse toggle. **Still not shipped from plan 0007:** 14k-repo DB import, GitHub API enrichment (last commit / topics), GitHub-momentum factor in scorer, entity-momentum overlay on `/entities`. See plan 0007 status section.

### Known gaps (real, not "todo theater")
- **Browser verification (visual)** — `wrangler dev` + `curl` end-to-end verified on 2026-05-25: every region / product / unknown-input path returns a well-formed brief even on an empty D1. Visual rendering of the web shell against this worker has not been double-checked in a real browser yet.
- **Weekly digest email** — `/digest/{weekly,rss,atom}` worker endpoints serve content; no SMTP / Resend hook exists. Wiring this needs a key + opt-in.
- **mentionpilot / agentMode migration** — the *product surfaces* are in this repo, but the source repos' deeper adapter logic was not ported in full. Consolidation rule says do not delete them until parity is verified.
- **D1 migrations on remote** — local migrations applied per convention; `pnpm db:migrate:remote` has not been verified for the latest agent-evaluation tables in this session.
- **Lab phase 1 completeness** — code is committed but no Postgres is running; bring-up is on the operator.

### Next concrete actions for the operator

Setup (one-time, in order):
1. `pnpm install` at repo root, `cd python/ingest && uv sync`, `cd python/lab && uv sync`.
2. `wrangler d1 create high-signal-db` → paste id into `workers/api/wrangler.toml`.
3. `pnpm db:migrate:local && pnpm db:seed:local` (and `:remote` when ready).
4. Set Clerk env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ADMIN_ALLOWED_EMAILS`.
5. Set worker AI env: `HIGH_SIGNAL_AI_API_KEY` (or `OPENAI_API_KEY`) + optional `HIGH_SIGNAL_AI_MODEL`, `HIGH_SIGNAL_AI_ENDPOINT_URL`. Unlocks real LLM calls for Mention checks, Community digests, Agent Eval prompts.
6. Set Modal Secret `high-signal` with: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `SEC_USER_AGENT`.

Run dev:
7. `pnpm dev` (web + worker), open <http://localhost:3000>.

Sync 4 weeks of data (Sarthak's 2026-05-25 directive — "sync at least 4 weeks of data everywhere"):

8. **Signals → D1**: `pnpm signals:sync:local` (markdown → local D1) then `pnpm signals:sync:remote` (markdown → prod D1). Re-running is idempotent; only changed slugs upsert.
9. **Fresh ingest, 28-day window**: `cd python/ingest && uv run python -m high_signal_ingest.pipeline --source all --days 28`. Drops drafts into `signals/<date>/`. Review + flip `review_status: published` in frontmatter, commit, then rerun step 8.
10. **Lab substrate (optional)**: see step 11 below.

Bring up Lab (Phase 1, optional):
11. `docker compose -f python/lab/docker-compose.yml up -d` (pgvector + pg_trgm; schema runs on first init).
12. `cd python/lab && uv sync` (+ `--extra embeddings` and/or `--extra entities` if you want those passes).
13. Pipeline (each step idempotent):
    - `uv run python -m high_signal_lab.ingest --limit 30`
    - `uv run python -m high_signal_lab.materialize --limit 50`
    - `uv run python -m high_signal_lab.github_trending`
    - `uv run python -m high_signal_lab.embed`  *(optional; downloads MiniLM on first run)*
    - `uv run python -m high_signal_lab.extract_entities` *(optional; runs GLiNER)*
    - `uv run python -m high_signal_lab.summarize` *(optional; needs `HIGH_SIGNAL_LAB_AI_BASE_URL` — Ollama default)*
    - `uv run python -m high_signal_lab.cluster`
    - `uv run python -m high_signal_lab.score`
14. `uv run python -m high_signal_lab.server` → <http://localhost:8765>.
15. `export LAB_API_URL=http://localhost:8765` then refresh `/lab` and `/review/lab-candidates`.


<claude-mem-context>
# Memory Context

# [high-signal] recent context, 2026-04-25 8:52pm GMT+5:30

No previous sessions found.
</claude-mem-context>
