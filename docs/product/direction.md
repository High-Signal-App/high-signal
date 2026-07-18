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
- **Core product**: one **Daily Brief** per user per day, generated end-of-day
  from the helpers below. The brief is the homepage for signed-in users.
- **Codename**: `high-signal` (rebrand TBD post-traction).

## Knowledge domains (three, no more)

1. **Technology** — what's launching, breaking, gaining adoption, getting deprecated.
2. **Startups** — what's being built, funded, killed; demand signals from communities.
3. **Finance** — what's worth watching in markets, sector moves, macro shifts that affect the above.

## Pricing

Everything is free for now. No paid tier, no billing, no Clerk metadata gates.
Region is a free filter, not a paywall. Revisit once usage proves a
willingness-to-pay surface. (See `scope-reset.md` — paid tiers explicitly out
of scope as of 2026-05-25.)

## Public default feed (homepage for any visitor, signed in or not) — 3 sections

1. **Stocks watching for a boom** — finance × technology overlap. Every claim
   shows the project's prior **hit-rate** on that signal type inline (the moat).
2. **Business ideas to build** — startups × community-demand signals.
3. **New lifestyle trends** — community + cultural shifts surfaced from forums
   and transcripts.

## Two more sections appear after a brand is connected

4. **How the market perceives your products** — mention intelligence over the
   connected brand.
5. **Ideas to improve your products** — agent-evaluation gaps for the connected
   brand.

## Region

Free filter on every section. Default = global. Users can switch to any region;
brief recomputes scoped to that region's entities + sources. Preference persists
via Clerk `publicMetadata.region` for signed-in users.

## Helpers / lenses (engine room, not destinations)

- **Markets lens** feeds section 1. The AI-infra / semiconductors signal pipeline
  + public hit-rate ledger remain the proof-of-quality.
- **Communities lens** feeds sections 2 and 3 — pain, demand, narrative,
  lifestyle drift.
- **Mentions lens** feeds section 4 — requires the user to connect a brand.
- **Agent Eval lens** feeds section 5 — requires the user to connect a brand.
- **Lab substrate** (plan `0007`) is the local-first ingestion + index layer
  underneath all of them.
- Surfaced under `/lenses/*` so the word "products" in the UI stays unambiguously
  about the user's brand, not about our intelligence surfaces.

## Sources

Infinite by design. Reddit, news, HN, YouTube transcripts, SEC filings, GitHub,
IR pages, papers, government feeds, prediction markets. The job is
**curation + cleaning + de-duplication**, not aggregation volume. The live
source catalog is regenerated from code at
[`operations/source-catalog.md`](../operations/source-catalog.md).

## Hard rules baked in

- **Cite or kill** — every claim in the brief points at ≥ 2 sources.
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
