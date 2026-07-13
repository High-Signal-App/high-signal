## Context

Plans 0008 and 0010 already shipped the claim ledger, watchlist tables, routes, impact composer, and editing surfaces. The remaining local-code gaps are at integration boundaries: auto-publish still judges legacy evidence arrays, historical signals have no lazy claim import, and the brief neither exposes claim provenance nor personalized watch impacts. Existing production tables are already applied, so this change must reuse them without schema or deployment work.

## Goals / Non-Goals

**Goals:**

- Make structured claim evidence authoritative whenever it exists.
- Backfill one deterministic historical claim on first operator provenance open.
- Compose at most five owner-scoped watch items with claim-backed evidence.
- Add compact, accessible provenance affordances without creating another page.
- Preserve fault tolerance when watchlist, graph, or claim data is absent.

**Non-Goals:**

- Applying migrations or changing production configuration.
- Batch backfilling all historical signals.
- Sending watchlist notifications or changing delivery cadence.
- Replacing the existing watchlist impact composer or adding graph editing.

## Decisions

1. **Use an authenticated, idempotent backfill endpoint.** `/review` will call an admin route before reading claims. The endpoint derives a deterministic claim ID from the signal ID, creates a claim from the signal headline/body and evidence URLs only when no signal claim exists, and returns the existing claim on retries. This keeps writes off the public read route and avoids a one-shot migration.

2. **Enrich auto-publish through the existing public claim read route.** For each queued signal, the script fetches claims by slug. If at least one structured claim exists, its distinct evidence URLs and host count replace legacy evidence counts for deterministic and AI judging. If no claim exists, the legacy payload remains an explicit compatibility fallback so older drafts are not silently killed during rollout.

3. **Keep brief provenance optional but typed.** Stock items may carry a compact claim reference and evidence-role counts. Legacy cached snapshots remain valid because the field is optional. The UI uses a native `details` disclosure for keyboard-accessible “why this is here” content.

4. **Build Watching from existing watchlist primitives.** The brief builder resolves the owner's default watchlist, loads direct and one-hop signals plus suppressions, reuses `composeImpactChain`, then joins eligible results to entities and structured claims. Items without a claim containing evidence are omitted, satisfying the claim-link contract. Empty or failing data returns `watching.items=[]` without affecting public sections.

5. **Do not write delta-log rows while rendering the brief.** This follow-up is a read/composition integration. Existing `/watchlists/:id/impact` retains delta logging; marking an item seen merely by composing a page would make retries and server rendering mutate user state unexpectedly.

## Risks / Trade-offs

- **Per-signal claim fetches add auto-publish requests** → Queue size is capped at 500 and the job already runs sequentially; requests are bounded and can later be batched behind a dedicated endpoint.
- **Legacy fallback delays full claim-ledger enforcement** → Results clearly report structured versus legacy provenance, and lazy review backfill steadily raises coverage without blocking the queue.
- **Watch items without claims disappear** → This is intentional cite-or-kill behavior; direct signal surfaces remain available elsewhere, and opening historical provenance can backfill a claim.
- **Owner query identity is trusted by the worker's existing brief contract** → This change does not broaden that established boundary; the web server continues deriving owner from Clerk.
