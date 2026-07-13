## Why

Plan 0011's OpenLens visibility scaffold is present, but the existing Mentions configuration still exposes imprecise terminology, completed checks do not keep cited-source evidence current, and the report route relies on an owner query instead of supporting a safe shareable URL. Closing these gaps makes the accepted v1 behavior coherent without adding schema or deployment work.

## What Changes

- Rename remaining Mentions configuration copy so buyer-intent contexts are called topics and concrete AI inputs are called prompts.
- Refresh the cited-source index after every completed mention check, alongside the existing intent-opportunity refresh.
- Allow visibility reports to be read either by the owning user or with a brand-scoped HMAC share token; token access fails closed when the server signing secret is unavailable.
- Add focused tests for the report token contract and post-check refresh wiring.
- Keep database migration 0012, PRD 0012, email/DNS, secrets, production configuration, and deployment out of scope.

## Capabilities

### New Capabilities

- `openlens-visibility-followups`: Defines topic/prompt product language, cited-source freshness after checks, and owner-or-token report authorization.

### Modified Capabilities

None.

## Impact

- Mentions configuration UI copy in `apps/web`.
- Mention check completion and OpenLens report routes in `workers/api`.
- Shared deterministic HMAC token helper in `packages/shared`.
- Existing OpenLens focused test script and plan/status documentation.
- No new dependency, database column, migration, secret value, or production change.
