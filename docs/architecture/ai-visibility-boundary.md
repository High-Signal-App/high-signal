# AI visibility package boundary

High Signal consumes the provider-independent
`@saas-maker/ai-visibility` engine from
`sass-maker/fleet-workspace/foundry/packages/ai-visibility`.

## Shared package owns

- mention, recommendation, sentiment, rank, competitor, and citation analysis;
- optional judge prompt/parsing with labeled deterministic fallback;
- prompt-provider matrix execution with call, concurrency, timeout, retry,
  cache, and cost contracts;
- provider/persona share of voice, visibility scores, citation gaps, trends,
  and report primitives.

The package has no runtime framework or database dependency. It does not own
credentials, customer identity, auth, routes, persistence, schedules, or UI.

## High Signal owns

- connected brands, aliases, competitors, prompts, and customer/owner identity;
- provider credential and endpoint resolution;
- D1 `mention_*` tables, migrations, result retention, and API routes;
- check lifecycle, auth, Daily Brief integration, Mentions pages, report
  sharing, and customer-facing copy;
- production schedules and deployment configuration.

`workers/api/src/lib/ai-visibility-adapter.ts` is the translation boundary. It
turns High Signal provider configuration into package adapters.
`workers/api/src/lib/mention-execution.ts` maps normalized attempts back into
the existing D1 rows. Database handles and customer identifiers never enter
the shared package.

## Local artifact

Until package publication receives separate approval, the repository consumes
the reviewed packed artifact under `vendor/`. The compatibility exports in
`packages/shared/src/mentions/` keep current High Signal imports stable. After
publication, replace only the package reference; the adapter and product-owned
surfaces remain unchanged.

## Parity gate

The package repository freezes representative MentionPilot fixtures. High
Signal adds an adapter contract suite and continues to run its AI visibility,
OpenLens, API contract, shared/API/web typecheck, docs, and build checks.
Provider-independent implementation should not be duplicated back into High
Signal.
