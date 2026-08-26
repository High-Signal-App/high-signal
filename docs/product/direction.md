---
title: Product Direction (Locked)
description: The authoritative locked product-direction snapshot for High Signal — brand, Daily Brief, sections, pricing, lenses, sources, and hard rules.
---

# Product Direction — Locked (2026-05-25)

This is the **authoritative product-direction snapshot**, referenced from
[`agents.md`](https://github.com/High-Signal-App/high-signal/blob/main/agents.md) and [`SPEC.md`](https://github.com/High-Signal-App/high-signal/blob/main/SPEC.md). It
supersedes the earlier "umbrella + 5 sub-products" framing in
[`plans/0004-platform-consolidation.md`](https://github.com/High-Signal-App/high-signal/blob/main/plans/0004-platform-consolidation.md).
The scope reset on 2026-06-03 ([`scope-reset.md`](scope-reset.md)) confirmed
which of these are active vs parked.

## Brand & core product

- **Brand**: High Signal.
- **Core product**: one public **Daily Brief** per day, generated end-of-day
  from the helpers below. The homepage exposes today's and yesterday's editions;
  earlier dated records live under Signals after a Turnstile human check.
- **Codename**: `high-signal` (rebrand TBD post-traction).

## Knowledge domains (three, no more)

1. **Technology** — what's launching, breaking, gaining adoption, getting deprecated.
2. **Startups** — what's being built, funded, killed; demand signals from communities.
3. **Finance** — what's worth watching in markets, sector moves, macro shifts that affect the above.

## Pricing

Everything is free for now. No paid tier, no billing, and no accounts at all —
see ADR-013.
Region is a free filter, not a paywall. Revisit once usage proves a
willingness-to-pay surface. (See `scope-reset.md` — paid tiers explicitly out
of scope as of 2026-05-25.)

## Public default feed (homepage for any visitor, signed in or not) — 3 sections

1. **Markets & companies** — finance × technology overlap. Each eligible item
   states what changed, why it matters, and the principal uncertainty. A direct
   **hit-rate** appears only after that exact signal type earns enough history;
   generic family percentages are not shown in the public edition.
2. **Business opportunities** — startups × retained community-demand signals.
3. **Behavior & culture** — community and cultural shifts surfaced from forums
   and transcripts.

The edition has no target length. More items may ship when each independently
clears the same editorial and evidence gates; no category is filled with seed or
synthetic fallback content. `ready`, `empty`, and `unavailable` are explicit
states, and an unavailable category prevents a new dated snapshot.

Today and yesterday remain anonymous and cacheable. There is no separate Brief
archive product: `/signals` is the chronological record, `/brief/archive`
redirects there, and briefs or signal proof pages older than yesterday require
one Turnstile check that grants 12 hours of human browsing. This is bot friction,
not an account, identity, payment, or personalization boundary.

### Presentation and history

Brief and Newspaper are presentation choices over the same edition content and
item order. The anonymous preference is stored only in the browser; it never
changes the request, canonical URL, metadata, cache identity, or root default.
There are no separate weekly digest, weekly/monthly publication, Featured,
Personal Brief, Ideas, Opportunities, or Teardowns products. Supported business
opportunities remain an evidence-qualified section inside the Daily Brief.

## No reader personalization

The public web edition is intentionally non-personalized. There are no reader
accounts, connected-brand brief sections, personal briefs, or rotating product
spotlights. Cloudflare Access protects only bounded operator review and
publishing paths.

## Region

Free filter on every section. Default = global. Visitors can switch region and
the public brief recomputes from that region's entities and retained sources.

## Inputs and research indexes

- **Markets lens** feeds Markets & companies. The AI-infra / semiconductors signal pipeline
  + public hit-rate ledger remain the proof-of-quality.
- **Communities input** feeds Business opportunities and Behavior & culture — pain, demand,
  narrative, and lifestyle drift. Curation remains operator-only.
- **Entities, sectors, convergence, and market context** remain supporting
  research indexes rather than standalone products.
- **Lab substrate** (plan `0007`) remains parked local infrastructure with no
  public UI.

## Company Universe

The source-backed Company Universe remains a first-class public research
surface. It preserves provenance from official accelerator and investor
directories and links company context back to current signals.

## Sources

Infinite by design. Reddit, news, HN, YouTube transcripts, SEC filings, GitHub,
IR pages, papers, government feeds, prediction markets. The job is
**curation + cleaning + de-duplication**, not aggregation volume. The live
source catalog is regenerated from code at
[`operations/source-catalog.md`](../operations/source-catalog.md).

Public capability coverage against The Daily Diff, Octolens, Peekaboo,
Subreddit Signals, AlphaSense, Quartr, and RavenPack is recorded at
`/methodology/data-parity`. Parity means an implemented public-data capability,
not matched source volume, language breadth, latency, proprietary models, or
licensed archives. Premium broker research, expert calls, licensed private-
company data, dependable restricted-social firehoses, and real-time global
earnings media remain explicit gaps.

The public Sources directory lists every configured source family with cadence,
freshness, last-run state, stored volume, and the latest retained data. Source
accuracy and the hit-rate ledger remain Track Record concerns rather than being
mixed into the source inventory.

## Hard rules baked in

- **Cite or kill** — every claim in the brief has a semantically aligned primary
  source plus independent corroboration on the same assertion. Context receives
  no support credit; unresolved contradiction and unusable receipts fail closed.
- **Archive only after the edition gate** — every included item must pass
  evidence, editorial, category, URL, and real-content checks before the dated
  snapshot is written. Existing archived snapshots remain immutable.
- **Memory is git-versioned markdown** — corrections are new entries citing
  prior, never edits. (See ADR-002 in
  [`../architecture/decisions.md`](../architecture/decisions.md).)
- **Public hit-rate ledger from day 1** — the moat.
- **Confidence as a band** — `low` / `medium` / `high`, calibrated post-hoc.

## Considered and deferred

- **Multi-collection engine for EverythingRated** (2026-04-26) — design archived
  at [`plans/0003-multi-collection-for-everythingrated.md`](https://github.com/High-Signal-App/high-signal/blob/main/plans/0003-multi-collection-for-everythingrated.md).
  Not shipped; reopening trigger is in that file.
- **Per-platform fan-out for Mentions/Agent-Eval** (Claude / ChatGPT / Perplexity
  / Gemini as distinct provider creds). Today both use one OpenAI-compatible
  endpoint and tag everything `platform: 'custom'`. Reopen if users demand
  per-platform breakdowns. (Note: Mentions multi-model fan-out landed 2026-07-04
  — see `../../PROJECT_STATUS.md`.)
- **Paid tiers / region gating** — explicitly out of scope (2026-05-25).
  Everything is free; region is a free filter. Revisit when usage proves
  willingness-to-pay.

## Consolidation rule

Do not delete or archive `mentionpilot` or `agentMode` until the relevant
features have been migrated into this repo and verified. Treat those repos as
read-only migration sources. Do not copy entire directories wholesale; port the
useful domain behavior into High Signal's app shell, schema, API, and ingest
boundaries.

## UI direction (locked)

**Futurist + very clean.** Visual credibility = signal credibility.

- Dark default. Monochrome zinc base. One accent (cyan-400) only on
  directional signals.
- Geist Sans + Geist Mono. Tabular numerals on every metric.
- 1px lines, no shadows, no rounded-3xl. Whitespace generous.
- Reference points: Linear, Vercel admin, Stripe Atlas, Bloomberg terminal,
  Perplexity detail views.
- Animations only on state change (signal published, hit-rate update). No
  decorative motion.
- The default Brief view preserves the evidence-terminal reading path.
  Newspaper may recompose the same semantic item order into a lead-plus-columns
  layout on wider screens and must collapse to one column on narrow screens.

## Out of scope (resist)

- Multi-wedge expansion before hit-rate is real.
- Agent UI / chat-over-docs (saturated by AlphaSense, Brightwave, Hebbia).
- Generic reel generation without evidence, positioning, or agent-readiness
  scoring.
- Licensed datasets (premature).
- Vector retrieval in the public signal product surface (defer until evidence
  search is the bottleneck) — the HighSignal Lab substrate (plan `0007`) does
  use `pgvector` internally; keep vector search inside Lab.
- Paid SaaS, billing, multi-tenancy.
- Mobile app, Discord/Slack alerts (RSS + email + Twitter is enough).
