## Why

Plan 0012 persists and reports buyer-intent opportunities, but the canonical
Daily Brief still omits those findings from its two brand-specific sections.
That leaves the accepted product loop incomplete: an operator must visit the
Mentions lens to discover the market signal and cannot see its recommended
response in the brief.

## What Changes

- Add a shared, source-linked intent summary to the Daily Brief contract.
- Include each connected brand's highest-scoring open intent finding in section
  4, even when that brand has no completed mention check yet.
- Add actionable open intent findings to section 5 while deduplicating any
  evidence task that already represents the same source.
- Render intent context and its source link in both the web brief and delivered
  brief output.
- Preserve existing section output when migration 0014 is not yet present or
  the intent query fails.
- Verify migration 0014 against an isolated local D1 only; remote application,
  deploys, credentials, and production configuration remain out of scope.

## Capabilities

### New Capabilities

- `intent-aware-daily-brief`: Brand-specific brief sections surface cited buyer
  intent and translate it into a reviewable next action.

### Modified Capabilities

None.

## Impact

- Shared Daily Brief types and email delivery mapping in `packages/shared`.
- Daily Brief composition in `workers/api/src/routes/brief.ts`.
- Brand-specific brief rendering in `apps/web`.
- Focused worker/shared tests and isolated local D1 migration evidence.
- No new dependency, route, remote migration, deployment, secret, or production
  configuration change.
