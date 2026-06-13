# Plan 0008 - Signal Provenance Editor And Claim Ledger

Status: proposed
Created: 2026-06-12
Depends on: `plans/0004-platform-consolidation.md`, `plans/0006-agent-evaluation-attention-layer.md`, `plans/0007-highsignal-lab-substrate.md`

## Thesis

High Signal already tracks evidence bundles and shows cited claims. The missing product is a first-class editing surface for claim provenance: every public assertion should be traceable, reviewable, and reproducible from the exact evidence that justified it.

The signal moat is not just "we cite sources." It is "we can explain why this claim exists, when it was created, what changed it, and which evidence pieces were decisive."

## Product contract

Input:
- a signal card, brief section, or agent-eval output
- one or more evidence URLs or source documents
- optional claim text and confidence band

Output:
- canonical claim record
- per-claim provenance timeline
- evidence contribution breakdown
- conflicting evidence warnings
- review state for publish / hold / kill

## Core workflow

1. A draft signal or brief claim is created.
2. The editor resolves the claim into one or more atomic assertions.
3. Each assertion gets linked evidence with a role:
   - primary support
   - corroboration
   - contradiction
   - background context
4. The editor records why the claim is allowed to ship.
5. Future corrections create a new linked claim, not a mutation.

## What this unlocks

- Better review of weak or thinly-supported claims.
- More useful correction history.
- A durable audit trail for the public hit-rate ledger.
- Reusable provenance for agent-eval audits and reel briefs.
- Cleaner support for "cite or kill" as a product rule instead of a slogan.

## Target User

- Review operators who need to decide whether a claim should publish.
- Future internal editors who need to understand why a claim existed.
- Operators who want to explain a signal to a teammate without losing the source trail.

## Rollout Slice

1. Start with signal detail pages and the review queue only.
2. Add provenance editing for new draft claims before touching historical claims.
3. Backfill only the most recent published items once the workflow is stable.

## Scope

### Add
- `claim_records` and `claim_evidence_links` in D1.
- A provenance editor on `/review`.
- A claim timeline view on signal detail pages.
- Import of evidence URLs from signal markdown frontmatter and agent-eval outputs.
- A correction flow that spawns a new linked claim version.

### Keep out
- General-purpose annotation on every page in the app.
- Full collaborative Google-docs style comment threads.
- Arbitrary freeform notebook behavior.

## Dependencies

- Existing evidence storage and markdown signal frontmatter.
- Review queue state transitions.
- Shared claim IDs in the brief and agent-eval outputs.

## Acceptance criteria

- Any published signal claim can show its supporting evidence chain.
- Corrections are visible as new claim versions, not overwrites.
- Review can distinguish support, contradiction, and context.
- The editor is usable on the existing review queue without creating a separate admin system.
- A reviewer can answer "why did this ship?" in under a minute from the claim record alone.
- The provenance trail survives correction without mutating the original evidence set.

## Risks

- Too much UI can slow the review flow.
- Over-modeling evidence roles could create needless ceremony.
- The feature should stay narrow: provenance for shipped claims, not a general notes product.
