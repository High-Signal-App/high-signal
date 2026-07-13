## Why

The accepted claim-provenance and entity-watchlist plans still leave the Daily Brief and auto-publish path dependent on legacy signal evidence arrays. Completing the structured path now makes publish decisions and personalized watch items traceable to the canonical claim ledger without requiring a batch migration.

## What Changes

- Make the auto-publish runner enrich each signal from `claim_records` and `claim_evidence_links`, using structured claim evidence when coverage exists and retaining the legacy signal payload only as an explicit compatibility fallback.
- Lazily create a historical signal claim and its evidence links when an operator first opens provenance in `/review` and no claim exists.
- Add compact claim provenance metadata to eligible stock and watchlist brief items.
- Compose a fault-tolerant, owner-scoped `watching` block for `/brief/daily`, linking each eligible item to a claim that has evidence.
- Render a concise “why this is here” provenance affordance and a signed-in Watching section in `/brief`.
- Keep production migration application, notification delivery, and graph editing out of scope.

## Capabilities

### New Capabilities

- `structured-claim-consumption`: Covers structured evidence use by auto-publish, lazy historical claim backfill, and compact brief provenance.
- `watching-brief-section`: Covers owner-scoped watchlist composition, claim-linked items, graceful degradation, and brief rendering.

### Modified Capabilities

None.

## Impact

Affected surfaces include the auto-publish script, claim/admin worker routes, Daily Brief worker composition and shared contracts, `/review`, `/brief`, and focused TypeScript tests. The change uses existing D1 tables and dependencies; it adds no migration, production configuration, or production dependency.
