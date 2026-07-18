---
title: Failed & Deferred Approaches
description: Approaches tried and abandoned, or deliberately deferred, with the reason and reopening trigger. Prevents re-walking the same dead ends.
---

# Failed & Deferred Approaches

Each entry records what was tried/considered, why it was dropped or deferred,
and the trigger that would justify revisiting. For decision rationale see
[`../architecture/decisions.md`](../architecture/decisions.md); for operational
pitfalls see [`learnings/lessons.md`](learnings/lessons.md).

## Modal as the daily scheduler → GitHub Actions

- **Tried:** Deployed daily ingest + scoring crons on Modal (2026-04-25).
- **Abandoned:** Migrated to GitHub Actions within one day (2026-04-26).
- **Why:** GitHub Actions is free for this CPU-bound workload, already in the
  repo, and avoids a second service + billing dependency. Modal cold-start
  overhead wasn't justified.
- **Kept:** `python/ingest/modal_app.py` for ad-hoc long backfills only.
- **Reopen trigger:** a GPU-heavy workload that GHA can't handle within 6h.

## Cloudflare Access for auth → Clerk

- **Tried:** CF Access (Zero Trust) for `/review` + `/api/admin/*` (2026-04-25).
- **Abandoned:** Adopted Clerk 2026-05-01.
- **Why:** CF Access is fine for a single-operator admin gate but lacks a full
  session model and user identity storage. The moment user-facing features
  (watchlists, brand configs, delivery preferences) were planned, a real
  session model became necessary.
- **Reopen trigger:** never without a migration plan (per `agents.md`).

## Five sub-products frame → one Daily Brief

- **Tried:** Framed High Signal as five sub-products (Markets, Communities,
  Mentions, Agent Eval, Lab) — plan 0004 (2026-05-01).
- **Abandoned:** Reframed around one Daily Brief 2026-05-25; confirmed by scope
  reset 2026-06-03.
- **Why:** A product positioned as "five things" is harder to explain than one
  thing with helpers. The brief as homepage gave a single user-facing artifact.
- **Reopen trigger:** a sub-surface proves enough standalone demand to warrant
  its own positioning.

## GLiREL automated relation extraction (deferred)

- **Considered:** Auto-extract supply/customer/peer edges with GLiREL.
- **Deferred:** `extract/relations.py` returns `[]`; hand-curated
  `relationships.csv` covers all live edges (ADR-004).
- **Why:** Accurate edges matter more than broad coverage at the AI-infra wedge
  size; GLiREL needs validation infrastructure to prevent hallucinated edges
  from corrupting the spillover map.
- **Reopen trigger:** validation infra exists and edge-discovery volume justifies
  it.

## VectorBT for backtesting (declared, never used)

- **Considered:** Use VectorBT for production backtest of signal hit-rates.
- **Declined:** `vectorbt>=0.26.0` is declared in `pyproject.toml` but never
  imported. Hand-rolled forward-return math over yfinance closes was sufficient
  (see `learnings/lessons.md`).
- **Why:** Reach for the heavy ML library last; the backtest semantics needed
  validating before adding startup cost and complexity.
- **Reopen trigger:** portfolio simulation / multi-signal strategy analytics
  outgrow hand-rolled math.

## Standalone arXiv adapter (built then removed)

- **Tried:** A dedicated arXiv adapter.
- **Removed:** Papers are already covered by Semantic Scholar; no second
  firehose wanted.
- **Why:** Source-layer deduplication principle — one canonical source per
  signal role.
- **Reopen trigger:** Semantic Scholar coverage proves insufficient for a
  specific paper-tracking need.

## OpenAlex (not implemented)

- **Status:** Was previously over-claimed in status docs; not implemented.
- **Why:** Semantic Scholar covers the papers signal role.
- **Reopen trigger:** Semantic Scholar rate limits or coverage gaps block a
  concrete signal.

## SaaS web review sites (Trustpilot/G2) — deferred

- **Tried:** Free API path for §4 perception.
- **Deferred:** No free API — Cloudflare-walled. The only free path is headed
  Playwright (works, but needs xvfb on CI + is anti-bot-fragile).
- **Reopen trigger:** §4 perception becomes a priority and a headed-browser lane
  is available.

## FINRA short interest (deferred — feasible, fiddly)

- **Status:** API confirmed accessible but rate-limited aggressively with low
  `limit` caps; needs offset-pagination + latest-settlement-period filter.
- **Why:** Not worth blocking the clean sources for a positioning signal.
- **Reopen trigger:** a focused pagination + backoff pass is justified by demand.

## Tier C municipal meeting-video transcription (out of scope)

- **Considered:** ASR over city-council meeting video (GatherGov's moat).
- **Out of scope:** Company-sized ASR effort.
- **Reopen trigger:** a watchlisted data-center jurisdiction publishes *only*
  video and its signal is proven valuable.

## Knowledgebase service dependency (deferred)

- **Status:** Separate fleet service; no dependency yet.
- **Why:** Vector retrieval in the public signal product surface is deferred
  until evidence search is the bottleneck (Lab uses `pgvector` internally only).
- **Reopen trigger:** evidence search becomes the product bottleneck.
