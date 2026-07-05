## Why

High Signal's ideas section should answer the same buyer question as a category-intelligence product, but with stronger evidence: should this opportunity be entered, tested, watched, or avoided? The current brief surfaces demand threads, but it does not yet carry the decision-grade fields needed to evaluate an opportunity quickly.

## What Changes

- Extend business-idea brief items into lightweight Opportunity Briefs with verdict, confidence, target user, problem, market timing, evidence mix, competitor/pricing/agent-visibility notes, risks, and next validation step.
- Keep the Daily Brief as the primary surface; the feature upgrades section 02 instead of creating a detached directory product.
- Add seeded Opportunity Brief data so anonymous and empty-D1 environments still demonstrate the full contract.
- Enrich real community-derived ideas with conservative default decision fields until source-specific evidence extraction is expanded.
- Render the enriched fields in `/brief` cards and keep existing links to `/opportunities` and `/communities`.
- Add focused tests around the shared fallback data and worker response shape.

## Capabilities

### New Capabilities

- `opportunity-briefs`: Decision-grade opportunity cards inside the Daily Brief, built from demand, evidence, competition, pricing, agent-visibility, risk, and validation-step fields.

### Modified Capabilities

- None.

## Impact

- Shared contracts and seed content: `packages/shared/src/core/brief.ts`, `packages/shared/src/content/seed-content.ts`.
- Worker API: `workers/api/src/routes/brief.ts` and brief route tests.
- Web UI: `apps/web/src/components/brief/BriefSections.tsx`.
- No new production dependencies, migrations, secrets, deploy changes, or external API requirements.
