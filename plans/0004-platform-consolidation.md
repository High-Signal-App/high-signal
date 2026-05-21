# Plan 0004 — High Signal Platform Consolidation

Status: active
Created: 2026-05-01
Supersedes: `plans/0001-research-artifact-first.md` as the top-level product direction. The AI-infra artifact remains a sub-product, not the whole company.

## Decision

High Signal becomes the umbrella product:

> High Signal extracts actionable signals from noisy public and semi-public information streams, then explains why they matter and what should happen next.

The existing `mentionpilot` and `agentMode` repos become source repositories for migration. They should not remain independent products once the relevant capabilities are rebuilt or ported into this repo.

The product direction also expands to cover the new marketing split:

> Win human attention, then win agent evaluation.

High Signal should not become a generic reel generator. It should evaluate whether a brand is recommendable by agents, identify the missing public evidence, and generate short-form briefs only when they are grounded in the same evidence layer.

## Product map

### 1. Mention Intelligence

Source repo: `/Users/sarthakagrawal/Desktop/Fleet/mentionpilot`

Job:
- Track how a company, brand, product, or competitor appears across AI assistants, web, communities, and launch channels.
- Help the user understand visibility, sentiment, share of voice, citations, and recommended fixes.

Keep:
- Project/team/account model.
- Brand config: name, aliases, URL, competitors.
- Prompt-based AI mention checks.
- Check history and result analysis.
- AI visibility score / badge concept.
- GEO tools where they directly explain or improve signal visibility.
- Social mention monitoring where it feeds the same company signal timeline.

Do not keep unchanged:
- The name `Mentionpilot` as the top-level brand.
- Any product copy that frames the whole company as only AI mention monitoring.
- The separate deployment boundary unless needed temporarily during migration.

### 2. Community Intelligence

Source repo: `/Users/sarthakagrawal/Desktop/Fleet/agentMode`

Job:
- Track subreddits and other communities for emerging pain, smaller app requirements, common complaints, demand, objections, product ideas, competitor mentions, and narrative shifts.
- Produce source-linked summaries, digests, and alertable signals.

Keep:
- Reddit OAuth fetcher.
- Top posts + comments extraction.
- Daily snapshots.
- Prompt-per-subreddit configuration.
- Structured AI summary with source references.
- Tracked subreddit list and email digest behavior.

Do not keep unchanged:
- The `AgentMode` product name.
- The monolithic Worker shape.
- Turso/libSQL as a long-term dependency if D1 is the consolidated store.
- Admin-only assumptions where the feature becomes user-facing.

### 3. Market Intelligence

Source repo: current `high-signal`

Job:
- Track evidence-backed company, sector, stock, and market signals with entity graphs, confidence bands, source bundles, and hit-rate tracking.
- Cover national and international stocks at a high level first: direction, affected names, sector pressure, spillover, and watch/ignore guidance.
- Remain public and evidence-first where possible because the public ledger is a trust moat.

Keep:
- Entity graph.
- Evidence-first signal cards.
- Append-only signal memory.
- Confidence bands.
- Hit-rate ledger.
- Manual review queue.
- Python ingest/scoring pipeline for sources that need heavier processing.

Change:
- The AI-infra / semiconductors wedge becomes the first public market collection, not the only long-term product scope.
- Add Indian public markets as the first national stock watch and US/global markets as the first international watch, but avoid deep single-stock research until high-level signal quality is stable.

### 4. Agent Evaluation Intelligence

Source repo: current `high-signal` plus the future Mention Intelligence migration

Job:
- Evaluate whether a company, product, or offer is legible, credible, and recommendable to AI assistants, buyer agents, search AI surfaces, and comparison workflows.
- Turn the strongest evidence and point of view into short-form reel briefs that can win a human's first attention slice before they ask an agent to validate the option.

Keep:
- Prompt-based AI mention checks from Mention Intelligence.
- Evidence-first signal cards, citations, and review gates.
- Community objections, pain, and competitor mentions as negative/positive evidence.
- Product-flow idea evaluation where it helps define who the offer is for and why it should win.

Add:
- `agent_evaluation_audit`: assistant answers, recommendation status, cited sources, competitor set, missing evidence, ambiguity penalties, and suggested fixes.
- `evidence_layer_score`: pricing clarity, proof specificity, comparison coverage, docs quality, policies, integrations, support terms, reviews, third-party validation, and public complaints.
- `reel_brief`: hook, angle, proof points, visual beats, CTA, claim boundaries, target segment, and linked evidence bundle.
- Monitoring prompts such as "best tools for X", "compare A vs B", "is X good", "alternatives to X", "complaints about X", and "who should not use X".

Do not add:
- A generic social scheduler.
- Mass AI content generation.
- Reel scripts that invent proof or outrun the evidence layer.

## Unified domain model

Build toward these core concepts:

- `workspace`: user/team-owned container.
- `collection`: a tracked domain such as a company, subreddit set, market wedge, competitor set, or custom watchlist.
- `source`: Reddit, AI assistant response, HN, Product Hunt, news, filing, IR page, changelog, GitHub, review site.
- `entity`: company, product, subreddit, person, sector, ticker, competitor, customer, supplier.
- `event`: raw or lightly-normalized observed thing from a source.
- `signal`: judged output that says what changed, why it matters, confidence, evidence, and suggested action.
- `evidence`: cited source item backing a signal.
- `run`: ingestion, AI extraction, scoring, or scheduled job audit record.
- `digest`: scheduled rollup of signals for a collection.
- `action`: recommended or executed next step; starts as suggested action, later can become agentic execution.
- `product_opportunity`: world-level change plus app requirement or complaint cluster, translated into what product should be built, for whom, why now, and what to validate next.
- `agent_evaluation_audit`: structured result of asking agents and search AI surfaces to compare, validate, or reject a brand/offer.
- `reel_brief`: evidence-backed short-form content plan tied to one collection, audience, and claim boundary.

## Architecture direction

Use this repo as the destination monorepo:

```txt
apps/web
  High Signal app shell
  /mentions       company and brand intelligence
  /communities    subreddit/community intelligence
  /markets        public market/entity intelligence
  /opportunities  proactive product ideas from world changes and complaints
  /personal       personal product graph mapped to build/change/watch actions
  /agent-eval     agent-readiness audits and evidence fixes
  /reels          evidence-backed short-form briefs
  /signals        unified signal feed
  /review         human review queue

workers/api
  Hono API for web, public embeds, scheduled jobs, and admin sync

packages/db
  D1/Drizzle schema for unified signal objects

packages/shared
  shared TypeScript types

packages/signal-engine
  common scoring, normalization, signal taxonomy, and evidence contracts
  create only when two sub-products actively share the same logic

python/ingest
  heavier source ingestion, entity extraction, graph/scoring jobs
```

## Migration sequence

### Phase 0 — Product consolidation docs

- Make this plan the active top-level direction.
- Update repo guidance so future work treats High Signal as the umbrella product.
- Preserve old repos; do not delete until migrated and verified.

### Phase 1 — Shell and navigation

- Reframe the web app around High Signal with four product areas:
  - Mentions
  - Communities
  - Markets
  - Agent Evaluation
- Keep the current Market Intelligence pages working.
- Add empty or read-only placeholder routes only if they help migration sequencing.

### Phase 2 — Shared schema foundation

- Add workspace/account primitives.
- Add collection/source/event/signal/evidence abstractions without breaking existing market routes.
- Migrate current market tables into the unified concepts only where it reduces duplication.

### Phase 3 — Community Intelligence import

- Port AgentMode's Reddit fetcher and summary contracts into `workers/api` or `python/ingest`, depending on runtime needs.
- Use D1/Drizzle, not Turso, for new persisted data.
- Keep source-linked summaries and snapshots.
- Add tracked subreddit collections and digests under the High Signal app shell.

### Phase 4 — Mention Intelligence import

- Port Mentionpilot's project/company configuration.
- Port prompt-based AI visibility checks.
- Port mention result analysis, trends, reports, and badge API.
- Keep GEO tools only where they directly support signal improvement.

### Phase 5 — Unified signal feed

- Normalize outputs from Mentions, Communities, and Markets into a single signal feed.
- Add filters by collection, source, entity, confidence, and signal type.
- Add action recommendations as a first-class field.
- Add a proactive opportunity view that answers what should be built from world-level changes, smaller app requirements, and repeated complaint clusters.

### Phase 5a — Agent Evaluation wedge

- Add a narrow audit workflow for one brand or product: target segment, URL, competitors, and buyer mission.
- Run a fixed prompt matrix across assistants/search AI where available, plus local scoring over pages, docs, pricing, FAQs, policies, reviews, and community mentions.
- Output a recommendation-worthiness report: what agents say, what evidence they cite, what they miss, why they would not recommend the product, and the highest-leverage fixes.
- Generate 3-5 reel briefs from only the strongest verified claims: one point of view, one proof object, one target buyer, one CTA.
- Feed missing-evidence tasks into the review/task workflow before generating more content.

### Phase 6 — Archive old repos

- After parity checks pass, freeze `/mentionpilot` and `/agentMode` with archive READMEs pointing to this repo.
- Do not delete history. Keep old repos available for blame, migration reference, and rollback.

## What not to do

- Do not copy entire directories wholesale into High Signal.
- Do not merge deployment configs blindly.
- Do not carry three auth systems forward.
- Do not preserve old names as top-level brands.
- Do not force the public market hit-rate ledger onto Mention or Community signals until their outcome metric is defined.
- Do not add a generalized `signal-engine` package before real duplicate logic appears in at least two migrated sub-products.

## Acceptance criteria for "consolidated"

- High Signal is the only outward-facing brand.
- Mentions, Communities, Markets, and Agent Evaluation are visible as product areas in one app shell.
- Product Opportunity Radar can generate build suggestions from existing market/community/mention evidence.
- Personal Command Brief can map those suggestions onto the user's actual product fleet.
- AgentMode's Reddit capability exists inside Community Intelligence.
- Mentionpilot's AI visibility/company monitoring exists inside Mention Intelligence.
- Agent Evaluation can produce a recommendation-worthiness audit and evidence-backed reel briefs for a single product.
- Market Intelligence still has evidence-backed signal cards and track-record behavior.
- Old repos are archived only after the migrated features are verified.

## Open questions

- Outcome metric for Mention signals: visibility improvement, citation gain, competitor share-of-voice delta, or alert resolution?
- Outcome metric for Community signals: subsequent post velocity, repeated pain cluster, upvote/comment growth, or manually marked usefulness?
- Whether public pages should exist for community/company collections, or whether those should be private by default.
- Whether the domain should be `highsignal.*`, `gethighsignal.*`, or a stronger available variant after domain/trademark checks.
