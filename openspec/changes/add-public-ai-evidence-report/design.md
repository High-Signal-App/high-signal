## Context

High Signal already has three useful primitives: a provenance-preserving company lookup, multi-provider Mentions checks, and `composeVisibilityReport`. The missing product loop is a signed-out, stable artifact that safely joins those primitives. The implementation crosses the Next.js app, Hono Worker, D1 schema, provider-budget controls, and evidence rendering, so the boundary must be settled before code is written.

The report is a free marketing/proof surface. It must preserve High Signal's cite-or-kill rule, avoid turning anonymous traffic into unbounded provider spend, and route interested users into the existing brand monitoring workflow rather than creating billing.

## Goals / Non-Goals

**Goals:**

- Produce a useful, source-linked report from a company name or domain.
- Reuse existing company, Mentions, citation, and evidence-task contracts.
- Make generated results stable, shareable, auditable, and honest about missing coverage.
- Establish a repeatable dogfood gate before public promotion.

**Non-Goals:**

- A new GEO dashboard, provider integration, paid tier, or billing flow.
- Unbounded anonymous live generation.
- Replacing the Daily Brief as the core signed-in product.
- Editing old snapshots when new source evidence appears.

## Decisions

### Use immutable report snapshots, not a live report URL

Each completed run writes a versioned snapshot whose public identifier resolves to stored content and evidence references. A company page can point to the latest snapshot, but a shared snapshot never silently changes.

Alternative considered: compose every read from current Mentions rows. Rejected because shared claims would drift, citations could disappear, and regressions would be hard to audit.

### Resolve identity before scheduling work

The Worker normalizes the input, calls the existing company-universe lookup, and obtains a canonical company id before it evaluates cache freshness or schedules checks. Creation is permitted only after request validation and abuse checks.

Alternative considered: keep report-only companies outside the universe. Rejected because it duplicates identity, competitor, and provenance logic.

### Reuse the Mentions engine through a report orchestrator

A thin orchestration service selects the existing prompt/persona matrix, invokes current provider routing, captures completion status, and hands stored rows to `composeVisibilityReport`. It adds lifecycle and snapshot persistence but does not fork answer grading.

Alternative considered: build a separate public prompt pipeline. Rejected because two visibility graders would drift and make dogfood results incomparable with the product.

### Treat citations and captured answers as report inputs

The snapshot stores structured references to captured answers, cited URLs, competitor mentions, and evidence tasks. Rendering derives display sections from those records; prose without a qualifying reference is omitted or labeled unavailable.

Alternative considered: ask a final model to write a polished audit from summaries. Rejected because it introduces unsupported claims at the most visible layer.

### Bound cost with reuse, quotas, and explicit admission

Requests first reuse a compatible snapshot inside a configurable freshness window. New work passes per-identity and per-company rate limits plus concurrency and daily provider budgets. Request admission and execution are separate so the UI can show queued/running states.

Alternative considered: synchronous generation in the page request. Rejected because it couples visitor latency to provider fan-out and makes budget enforcement fragile.

### Launch through reviewed dogfood artifacts

The first cohort is a fixed fleet set. A report is approved only after a checklist review of attribution, traceable citations, competitor accuracy, missing-evidence handling, and usefulness. Broad promotion is an operator-controlled readiness flag, not an automatic count threshold.

Alternative considered: publish immediately and use traffic as QA. Rejected because one unsupported public claim damages the evidence-first positioning.

## Risks / Trade-offs

- [Anonymous generation can create cost spikes] → Cache compatible reports, enforce layered admission limits, cap provider work, and degrade to queued/rate-limited states.
- [Company matching can attach evidence to the wrong entity] → Show the resolved identity before execution and retain submitted input plus match provenance in the request record.
- [Provider disagreement can make the report look inconsistent] → Preserve per-provider coverage and mark partial results; do not collapse disagreement into an invented consensus.
- [Public citations can contain unsafe or low-quality URLs] → Reuse cited-source classification and render normalized destinations with safe link attributes.
- [Immutable snapshots can become stale] → Display generation time and offer an explicit newer-snapshot link without rewriting old artifacts.

## Migration Plan

1. Add snapshot/request tables and indexes in a reversible D1 migration.
2. Add shared contracts and persistence methods, then the bounded Worker orchestration endpoints.
3. Add signed-out intake, lifecycle polling, snapshot rendering, and product routing.
4. Generate the fixed internal cohort and review it against the quality checklist.
5. Enable broad promotion only after the operator records the gate as passed.

Rollback disables new request admission and the public route while retaining snapshots for audit. The additive schema can remain until a later cleanup migration.

## Open Questions

- What freshness window balances provider drift against cost for the first cohort?
- Which exact prompt/persona subset is mandatory for a report to be `ready` rather than `partial`?
- Should approved examples be pinned indefinitely even after a newer company snapshot exists?
