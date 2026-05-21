# High Signal

High Signal extracts actionable signals from noisy public and semi-public information streams, then explains why they matter and what should happen next.

The product now has four intended sub-products:

- **Mention Intelligence** — company, brand, competitor, and AI-visibility signals. Migration source: `/Users/sarthakagrawal/Desktop/Fleet/mentionpilot`.
- **Community Intelligence** — subreddit/community demand, pain, smaller app requirements, repeated complaints, narrative, and trend signals. Migration source: `/Users/sarthakagrawal/Desktop/Fleet/agentMode`.
- **Market Intelligence** — high-level national and international stock, company, sector, and market signals with entity graphs and hit-rate tracking. This repo's current AI-infra / semiconductors artifact becomes the first market collection.
- **Agent Evaluation Intelligence** — audits whether a brand, product, or offer is legible, credible, and recommendable to AI assistants and buyer agents; pairs the evidence layer with short-form reel briefs that win the first human attention slice.

Active consolidation plan: `plans/0004-platform-consolidation.md`.

## What it does today
- Ingests SEC filings, IR pages, AI-infra news/blogs, Reddit, GitHub, government feeds, YouTube transcripts, HKEX announcements, GDELT, and prediction markets
- Extracts events + entities + relationships
- Turns world-level changes and repeated app complaints into product opportunities under `/opportunities`
- Maps those opportunities onto the personal product graph under `/personal`
- Drafts daily signal candidates across low / medium / high confidence bands
- Predicts direction + 2nd-order spillover via supplier/customer/peer graph
- Publishes reviewed signal cards + weekly digest
- Auto-backtests every signal — public hit-rate ledger updated continuously

## Why the first market wedge still matters
- Small entity graph (~150 names) — tractable solo
- News-dense, retail-attentive, spillover-dominant alpha pattern (TSMC capex → ASML → HBM → cloud capex → power names)
- Existing incumbents (AlphaSense, Brightwave, Daloopa) own enterprise research workflows; nobody ships a directed spillover graph + public hit-rate
- Source layer is fully covered by OSS — no licensed feeds required for v0

## Status
Scaffolded as the Market Intelligence artifact. Worker API + Next.js web + Python ingest + 274 entities + 175 relationships + 31 signal types + 168 sources all committed. Awaiting consolidation work for Mention Intelligence, Community Intelligence, and Agent Evaluation Intelligence.

## Architecture
```
apps/web              Next.js 16 + Tailwind v4 — futurist + clean UI
workers/api           Hono on Cloudflare Workers + D1 binding + cron
packages/db           Drizzle schema + migrations (sqlite/D1)
packages/shared       Cross-package types
python/ingest         uv-managed: edgartools, Trafilatura, GLiNER, FinBERT, yfinance
  └ GitHub Actions runs daily ingest, markets polling, and scoring
signals/              Git-versioned, append-only signal markdown
scripts/              CSV→D1 + signals.md→D1 sync
```

## Quickstart
```bash
# 1. Node deps
pnpm install

# 2. Python deps
cd python/ingest && uv sync && cd -

# 3. Cloudflare D1
wrangler d1 create high-signal-db        # paste the id into workers/api/wrangler.toml
pnpm db:migrate:local
pnpm db:seed:local                       # loads 274 entities + 175 relationships
pnpm product-flow:seed:local             # loads reviewed product-flow evidence for /ideas
pnpm personal:brief                      # prints the personal build/change/watch brief
pnpm personal:brief refresh-sources      # refreshes public product-flow evidence from tracked communities
pnpm personal:brief feedback high-signal-agent-evaluation build build "core direction"
pnpm personal:brief decide high-signal-agent-evaluation accepted build "turn this into next work"
pnpm personal:brief tasks                # prints SaaS Maker-ready task drafts from accepted actions
pnpm personal:brief sync-tasks           # dry-runs idempotent SaaS Maker task creation
pnpm personal:brief sync-tasks --apply   # creates missing accepted-action tasks via SaaS Maker
pnpm personal:brief report               # writes reports/personal/YYYY-MM-DD.md for weekly review

# 4. Env (.dev.vars + Modal Secret named `high-signal`)
#   AI_BASE_URL, AI_API_KEY, AI_MODEL
#   SEC_USER_AGENT="your-name your@email"

# 5. Dev
pnpm dev                                 # web (3000) + worker (8787)

# 6. Draft signals
cd python/ingest && uv run python -m high_signal_ingest.pipeline --source news --days 1

# 7. Review + publish
#   - open signals/<date>/<slug>.md
#   - flip review_status: published
#   - git commit
pnpm signals:sync:local
```

## Quick links
- Spec: `SPEC.md`
- Consolidation plan: `plans/0004-platform-consolidation.md`
- Plan: `plans/0001-research-artifact-first.md`
- Product opportunity radar: `/opportunities`
- Personal command brief: `/personal`
- Research: `research/market-and-oss.md`
- Stack + conventions: `agents.md`
- Seed corpus: `python/ingest/src/high_signal_ingest/seed/`
- Example signal: `signals/2026-04-25/example-nvda-h100-lead-time.md`
- Ingest runbook: `docs/ingest-runbook.md`
- Source coverage / launch scope: `docs/source-coverage.md`
- Seeding guide: `docs/seeding.md`

## Deploy
- Web → Cloudflare Workers via OpenNext (`.github/workflows/deploy-web.yml`)
- API → Cloudflare Workers (`.github/workflows/deploy-api.yml`)
- Ingest / markets / scoring → GitHub Actions cron
- Modal remains for manual long backfills (`cd python/ingest && uv run modal run modal_app.py::manual_backfill ...`)

## Naming
Codename `high-signal` collides with High Signal Labs / High Signal HQ. Final brand TBD post-traction.
