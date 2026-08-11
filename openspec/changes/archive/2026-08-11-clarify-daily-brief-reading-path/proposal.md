## Why

High Signal's broad technology, startup, and finance coverage is an advantage, but the current public entry path presents the product as several adjacent tools and lets demo fallbacks, structural citation checks, and metadata-heavy cards dilute the Daily Brief's editorial quality. A new visitor should immediately know to read today's brief, scan its categories, open the strongest underlying signals, and use the archive, sources, and track record only when they want more depth.

## What Changes

- Make the current Daily Brief the unambiguous public starting point. The root route presents today's brief, `/brief` remains a compatibility route, and primary navigation leads with Brief, Signals, Track record, and Sources.
- Keep the broad public categories—markets and companies, business opportunities, and behavior and culture—and add an issue-level contents row with category labels, item counts, and in-page anchors.
- Replace target item counts with quality-threshold publishing. The brief may contain more items when coverage supports them, but it never fills a category to meet a quota.
- Remove synthetic stock, idea, and trend fallbacks from public and archived briefs. Empty, partial, and unavailable states are explicit and are never snapshotted as real editorial output.
- Remove the public product picker, rotating product spotlight, and personalized sections from the public web brief. Mentions, Agent Eval, their stored data, and existing authenticated delivery behavior remain available on their dedicated surfaces.
- Add a compact editorial payload to each market signal card: what changed, why it matters, and the principal uncertainty or invalidation condition. Preserve the full signal page for deeper evidence and spillover analysis.
- Make structured evidence roles enforceable: only semantically aligned primary and corroborating sources satisfy the publication gate; context does not count, contradiction blocks publication, and dead or inaccessible links fail closed.
- Add an edition-level quality gate before a dated snapshot becomes part of the permanent archive. The gate checks real-only content, sentence and link integrity, category labeling, and the required evidence contract; it does not introduce a second archive system.

## Capabilities

### New Capabilities

- `daily-brief-reader-path`: Defines the public entry route, primary navigation, category contents, in-page reading sequence, and routes to deeper evidence.
- `daily-brief-editorial-quality`: Defines real-only category composition, richer inline summaries, semantic evidence alignment, variable issue size, explicit empty states, and the pre-snapshot edition gate.

### Modified Capabilities

- `structured-claim-consumption`: Require publication and brief eligibility to distinguish semantically supporting evidence from context and contradiction, and to fail closed on unusable evidence links.
- `opportunity-briefs`: Remove synthetic fallback Opportunity Briefs from public Daily Brief composition while preserving real cited opportunities and the standalone opportunities surface.
- `intent-aware-daily-brief`: Remove personalized and rotating demo sections from the public web brief while preserving dedicated Mentions and Agent Eval surfaces and backward-compatible authenticated delivery behavior.

## Impact

- Affects the root and `/brief` routes, primary navigation, Daily Brief hero and section components, archive precompute, public brief API/types, structured claim evaluation, opportunity composition, and focused tests.
- Changes public information architecture and brief composition but does not delete signals, Mentions, Agent Eval, watchlists, seed utilities used by tests or explicit demos, or historical archived snapshots.
- Requires no new production dependency, database migration, secret, provider, deployment, or destructive data operation.
- Existing ShareBar and footer edits in the working tree are preserved and incorporated rather than replaced.
