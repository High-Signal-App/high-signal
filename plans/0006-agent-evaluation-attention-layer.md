# Plan 0006 - Agent Evaluation And Attention Layer

Status: proposed
Created: 2026-05-20
Depends on: `plans/0004-platform-consolidation.md`

## Thesis

Future marketing splits into two jobs:

1. Win human attention.
2. Win agent evaluation.

High Signal should lead on the second job and use the first job only as a focused entry point. Reels create awareness, memory, and emotional pull. Agent evaluation decides whether the product is legible, credible, and recommendable when a buyer asks an AI assistant to compare options.

The product should therefore combine:

- human magnetism: short-form briefs that make a person care
- machine-readable credibility: public evidence that agents can retrieve and cite
- transaction readiness: pricing, docs, policies, integrations, and trust surfaces agents can evaluate

## Product Contract

Input:
- brand or product URL
- target buyer / mission
- competitors or alternatives
- pricing/docs/policy/review/source URLs where available
- optional founder POV or content examples

Output:
- agent-evaluation audit
- evidence-layer score
- missing-evidence tasks
- competitor comparison map
- 3-5 reel briefs grounded in verified proof

## Agent-Evaluation Audit

The audit should answer:

- Does the brand show up when agents are asked for the best tools for the mission?
- Is the summary accurate?
- Which competitors are mentioned instead?
- What claims are unsupported?
- What public evidence is missing or stale?
- What would make an agent recommend this product over five alternatives?
- Who should not use this product?

Prompt matrix:

- best tools for `[buyer mission]`
- compare `[brand]` vs `[competitor]`
- is `[brand]` good for `[segment]`
- alternatives to `[brand]`
- complaints about `[brand]`
- who should not use `[brand]`
- what is the pricing, refund policy, support policy, implementation time, and integration surface?

## Evidence-Layer Score

Score each area as `missing`, `weak`, `clear`, or `strong`:

- positioning clarity
- target segment
- pricing clarity
- comparison coverage
- proof specificity
- reviews and third-party validation
- case studies with numbers
- docs and implementation guide
- security/compliance
- integrations
- support terms
- refund/cancellation policy
- public complaints and objections
- schema/API/feed readiness

The score must cite source URLs or mark the area as missing. No inferred strength without evidence.

## Reel Brief

Reels are not the product by themselves. They are attention entry points into the evidence layer.

Each brief includes:

- target human
- buyer mission
- hook
- core tension
- proof object
- visual beats
- spoken outline
- caption
- CTA
- claim boundary
- linked evidence bundle

Rules:

- One reel equals one remembered idea.
- No generic "AI will change X" content.
- No claims without evidence.
- Prefer contrast, objection, teardown, proof, or specific customer job.
- The reel should make the viewer know what to ask an agent later.

## First Build

Use a single-product workflow before broadening:

1. Create `/agent-eval` with a form for product URL, buyer mission, and competitors.
2. Store an audit run with raw assistant/search answers, extracted claims, cited sources, competitor mentions, and missing evidence.
3. Add an evidence-layer scoring view.
4. Add a missing-evidence task list.
5. Generate 3 reel briefs from the strongest verified claims.
6. Add a review gate before publishing/exporting briefs.

## Non-Goals

- generic social media scheduler
- trend-jacking content factory
- synthetic testimonials or fake proof
- paid ad campaign management
- broad SEO content calendar
- automated publishing before review

## Acceptance Criteria

- One real product can be audited end to end.
- The audit clearly states why an agent would or would not recommend it.
- Every score has a cited source or a missing-evidence label.
- The reel briefs only use verified claims from the audit.
- The workflow creates concrete fixes before creating more content.
