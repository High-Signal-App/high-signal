# Plan 0010 - Entity Watchlists And Impact Chains

Status: proposed
Created: 2026-06-12
Depends on: `plans/0001-research-artifact-first.md`, `plans/0007-highsignal-lab-substrate.md`

## Thesis

High Signal already has entities, relationships, and spillover logic, but the experience is not yet shaped around the operator's real "watch this name and tell me what moved" workflow.

The next major product is an entity watchlist system that turns raw entity graphs into active impact chains:

- what changed
- who is directly affected
- which second-order names matter
- what to ignore
- what to watch next

## Product contract

Input:
- a company, ticker, repo, product, or sector entity
- watch preferences
- region and horizon

Output:
- prioritized watchlist item
- impact chain
- watch/ignore recommendation
- follow-up entities
- source bundle and confidence band

## Why now

- Users do not think in tables; they think in names they care about.
- Watchlists are the simplest way to make the signal engine personal without giving up evidence discipline.
- Impact chains are the natural bridge between the brief and the underlying graph.

## Target User

- Analysts and operators who track a small set of companies, products, or repos.
- Founders who want to know when a competitor or supplier moves.
- Investors who care about second-order spillover instead of raw mention volume.

## Rollout Slice

1. Entity pages first, with manual watch/unwatch.
2. Add brief-level impact-chain cards for watched entities.
3. Add suppression rules and alert-worthy deltas after the basic watch loop works.
4. Only then consider scheduled delivery of watchlist updates.

## Scope

### Add
- Explicit watchlist management for entities.
- Impact-chain cards on entity pages and in the brief.
- "Why am I seeing this?" explanations with the direct and second-order path.
- Alert-worthy deltas for tracked names.
- Lightweight ignore rules to suppress repeated noise.

### Keep out
- Arbitrary graph editing.
- Full portfolio management.
- Real-time trading alerts.
- Unlimited notification channels.

## Dependencies

- Entity graph and relationship edges.
- Evidence bundles for the underlying claims.
- Region and horizon filters from the brief.
- A stable entity identity model across signals, mentions, and lab results.

## Acceptance criteria

- A user can add an entity and see its impact chain within the existing app shell.
- The chain explains direct and second-order relevance in plain language.
- Noise suppression is user-controlled.
- The feature does not require new product branding.
- Each watch item shows the concrete trigger that surfaced it.
- A user can tell which relationships are inferred versus directly observed.

## Risks

- Watchlists can become noisy if alert thresholds are too broad.
- The system needs strict evidence thresholds so the chain does not become speculative.
- If overdone, this becomes a generic portfolio tracker, which is not the goal.
