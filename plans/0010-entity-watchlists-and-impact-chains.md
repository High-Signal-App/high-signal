# Plan 0010 - Entity Watchlists And Impact Chains

Status: implemented
Created: 2026-06-12
Last updated: 2026-07-13
Depends on: `plans/0001-research-artifact-first.md`, `plans/0007-highsignal-lab-substrate.md`

## Implementation state

This PRD is complete as a product spec and accepted into active scope. The v1 scaffold now exists:

- D1 migration `packages/db/migrations/0011_watchlists.sql`.
- Worker routes mounted under `/watchlists/*`, including the `default` alias for a user's primary watchlist.
- Clerk-fronted Next.js proxy at `/api/watchlists/[...path]`.
- Entity-page watch action on `/entities/[id]`.
- Watchlist management surface at `/watchlist/entities`.
- Shared impact composer in `packages/shared/src/watchlist-impact.ts` with suppression, observed/inferred labels, and priority math.
- Owner-scoped Daily Brief `watching` composition with direct and one-hop items, horizon/suppression filtering, confidence context, and fault isolation.
- Claim/evidence linkage for every surfaced watch item plus a compact relationship/provenance disclosure in `/brief`.
- Unit coverage in `scripts/watchlist-impact.test.ts`.

Migration `0011_watchlists.sql` was applied to remote D1 on 2026-06-28. The existing route split is retained: `/watchlist` remains the lens hub and `/watchlist/entities` remains the concrete management surface. No migration or deploy was run as part of the 2026-07-13 local-code completion.

## Thesis

High Signal already has entities, relationships, and spillover logic, but the experience is not shaped around the operator's real "watch this name and tell me what moved" workflow.

The next major product is an entity watchlist system that turns the existing entity graph into **active impact chains**:

- what changed
- who is directly affected
- which second-order names matter
- what to ignore
- what to watch next

The win is not "another portfolio tracker." It is the brief, scoped to names a user cares about, with spillover made legible and evidence still mandatory.

## Product contract

Input:
- a company, ticker, repo, product, or sector entity
- watch preferences (horizon, region, suppression rules)
- existing relationship graph + signal stream

Output:
- prioritized watchlist item with a triggering event
- impact chain (direct → second-order, with relationship type)
- watch / ignore recommendation
- follow-up entities worth adding
- source bundle and confidence band

## Why now

- Users do not think in tables; they think in names.
- Watchlists are the simplest way to make the signal engine personal without giving up evidence discipline.
- Impact chains are the natural bridge between the brief and the underlying graph — and they are how High Signal differentiates from generic news readers.

## Target user

- Analysts and operators who track a small set of companies, products, or repos (5–50 names).
- Founders who want to know when a competitor or supplier moves.
- Investors who care about second-order spillover instead of raw mention volume.

Not the target: traders who need millisecond alerts. The horizon here is "today" / "this week", not "this hour".

## User stories

1. As an operator, I open an entity page (`/entities/[slug]`), hit "watch", and see that entity appear in `/watchlist/entities` with its current impact chain.
2. As a brief reader, I see a "Watching" section in `/brief` that surfaces only watched entities and their fresh signals, with a one-line impact-chain teaser per item.
3. As a user adding a noisy entity (e.g., NVIDIA), I add a suppression rule ("only earnings, capacity, or supply") and stop seeing low-signal items.
4. As an operator reading a second-order item ("ASML dropped because TSMC delayed capacity"), I can expand to see the relationship type and the evidence behind the link.
5. As a user, I can click "ignore second-order from this edge" and that path is suppressed for me going forward.

## Core workflow

1. User adds an entity to a watchlist. Watchlist is private to the user.
2. The brief composer (`workers/api/src/routes/brief.ts`) reads the watchlist on every render and computes the "Watching" section in parallel with the public sections.
3. For each watched entity, the composer pulls the most recent N signals where the entity is direct subject, then walks `relationships` one hop to find second-order signals (subject is connected to the watched entity).
4. Each surfaced item is scored: `priority = recency * confidence_band * relationship_weight * (1 - suppression_match)`.
5. Items below a per-user threshold drop off. Suppression rules remove categories of items (signal type, source, or relationship edge).
6. Each surfaced item carries a "why am I seeing this?" line: the relationship path from the watched entity to the surfaced signal's subject.

## Impact chain shape

An impact-chain card has:

- the triggering signal (assertion + cite link to claim record)
- the direct entity (who moved)
- 0–3 second-order entities (who is affected and via which relationship: `supplier_of`, `customer_of`, `peer_of`, `regulator_of`, `partner_of`)
- a confidence band on the second-order link (`observed | inferred`)
- the recommended action: `watch | ignore | add to watchlist`

Second-order edges are inherited from `relationships`. If an edge is `unverified` (the cleanup flag from the existing schema), the chain shows `inferred` and lowers the priority weight.

## Data model (D1)

Migration `0011_watchlists.sql`:

```sql
CREATE TABLE `watchlists` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL DEFAULT 'default',
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `watchlists_user_name_idx` ON `watchlists`(`user_id`, `name`);

CREATE TABLE `watchlist_entities` (
  `id` text PRIMARY KEY NOT NULL,
  `watchlist_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `horizon` text NOT NULL DEFAULT 'week',  -- 'day' | 'week' | 'month'
  `added_at` integer NOT NULL,
  `note` text,
  FOREIGN KEY (`watchlist_id`) REFERENCES `watchlists`(`id`)
);
CREATE UNIQUE INDEX `watchlist_entities_unique_idx`
  ON `watchlist_entities`(`watchlist_id`, `entity_id`);
CREATE INDEX `watchlist_entities_entity_idx`
  ON `watchlist_entities`(`entity_id`);

CREATE TABLE `watchlist_suppressions` (
  `id` text PRIMARY KEY NOT NULL,
  `watchlist_id` text NOT NULL,
  `kind` text NOT NULL,                    -- 'signal_type' | 'source' | 'edge_type' | 'second_order_from'
  `value` text NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX `watchlist_suppressions_wl_idx`
  ON `watchlist_suppressions`(`watchlist_id`);

CREATE TABLE `watchlist_delta_log` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `watchlist_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `signal_id` text NOT NULL,
  `delta_kind` text NOT NULL,              -- 'direct' | 'second_order'
  `surfaced_at` integer NOT NULL
);
CREATE INDEX `watchlist_delta_user_idx`
  ON `watchlist_delta_log`(`user_id`, `surfaced_at`);
```

The delta log is not the source of truth for the brief — it is a record of what the user saw, used for suppression analysis and "since last visit" computation.

## Composer changes

`workers/api/src/routes/brief.ts` gains a new `safe()`-wrapped section: `watchingSection()`. It runs only when the request includes a signed-in `user_id` with at least one watchlist entry.

Inputs to the section:
- `watchlist_entities` for the user
- `signals` published in the last `horizon` window where `entity_id` ∈ watchlist OR `entity_id` joined via `relationships`
- `claim_records` for evidence-link counts and roles (from plan `0008`)
- `score_runs` for confidence bands
- `watchlist_suppressions` for filtering

Output shape extends the existing `BriefSnapshot` with a `watching: { items: WatchItem[] }` block. `WatchItem` carries the impact chain.

The composer is fault-tolerant: empty graph or missing claims fall back to direct entity signals only, never an empty card.

## API surface (worker)

Routes in `workers/api/src/routes/watchlists.ts`:

- `GET /watchlists` — list user's watchlists with item counts.
- `POST /watchlists` — create a new named watchlist.
- `POST /watchlists/:id/entities` — add an entity (by slug or id).
- `DELETE /watchlists/:id/entities/:entityId` — remove.
- `POST /watchlists/:id/suppressions` — add a suppression rule.
- `DELETE /watchlists/:id/suppressions/:rule_id` — remove suppression.
- `GET /watchlists/:id/impact` — current impact-chain items for the watchlist.

Brief route `/brief/daily` is extended to include the watching block when `user_id` resolves to a watchlist.

## Web surface

- `/entities/[slug]` gains a "watch" action that creates or appends to the user's default watchlist.
- `/watchlist/entities` — the user's primary entity-watchlist view. Lists entities, impact-chain cards per entity, suppression rules.
- `/brief` — adds a "Watching" section between the public and personal blocks, only for signed-in users with at least one watched entity.
- "Why am I seeing this?" expands to show the relationship path and links to the underlying `claim_record`.

No new branding. No `/products/*` route. Reuse `system/*` components and the existing entity-card / signal-card pattern.

## Alert deltas

A delta is a signal worth resurfacing: `signal_id` ∈ watchlist scope AND not yet in `watchlist_delta_log` for that user. The watching section shows the latest 5 deltas per visit. No email or push in v1 — delivery is handled by plan `0009` if the user has it enabled.

Future: plan `0009` can read deltas and include them in a "since yesterday" line on the email brief.

## Telemetry

- `watchlist.entity_added`, `watchlist.entity_removed`
- `watchlist.suppression_added` with `kind` dimension
- `watching.section_rendered` with `item_count`, `direct_count`, `second_order_count`
- `watching.why_expanded` — how often users care about provenance
- `watching.ignore_edge_clicked` — signals that an edge is consistently noisy

If `watching.why_expanded` runs above 30% of section views, deepen the explanation. If it stays under 5%, the provenance affordance is too quiet.

## Rollout slice

1. Migration + worker routes + entity-page "watch" action + `/watchlist/entities` listing with direct signals only.
2. Brief integration: "Watching" section, direct entities only, no second-order.
3. Impact chain: add second-order one-hop via `relationships`, with `observed | inferred` labelling.
4. Suppression rules surface and back-end filtering.
5. Delta log + "since last visit" affordance.
6. Hook plan `0009`'s email brief into deltas — only after delivery is stable.

## Scope

### Add
- `watchlists`, `watchlist_entities`, `watchlist_suppressions`, `watchlist_delta_log` in D1.
- Worker routes under `/watchlists/*`.
- Entity-page watch action.
- `/watchlist/entities` page.
- Brief composer extension.
- Impact-chain rendering with relationship-path explanation.

### Keep out
- Arbitrary graph editing.
- Full portfolio P&L / position tracking.
- Real-time price alerts.
- Unlimited notification channels.
- Public sharing of watchlists.

## Dependencies

- Stable `entities` and `relationships` tables.
- `signals`, `claim_records` (plan `0008`), `score_runs` for evidence and confidence.
- Brief composer's `safe()` fault-tolerance pattern.
- Plan `0009` for any external delivery of deltas.

## Acceptance criteria

- A signed-in user can add an entity from `/entities/[slug]` and immediately see it in `/watchlist/entities`.
- The brief's "Watching" section renders without errors on empty graphs or missing claims (degrades to direct entity only).
- Impact-chain items label `observed` vs `inferred` second-order edges; inferred items are visually subdued.
- "Why am I seeing this?" shows the relationship path in plain language.
- A suppression rule reliably removes matching items on the next brief render.
- Each watch item links back to a `claim_record` with at least one evidence URL.
- No watch item ships without confidence-band context.

## Non-goals

- Real-time updates. The brief refreshes on its existing cadence; watchlist scope rides that cadence.
- Cross-user watchlist sharing.
- Recommendation engine for "people who watch X also watch Y" — too easy to misuse.

## Risks

- Watchlists become noisy if alert thresholds are broad. Mitigation: per-user threshold + suppression rules from v1.
- Second-order spillover devolves into speculation. Mitigation: confidence-band labels are mandatory; `inferred` edges weight lower.
- Generic portfolio drift. Mitigation: no P&L, no position tracking, no "value" math anywhere in the surface.
- Graph completeness varies by sector. Mitigation: show "no second-order found" honestly instead of inferring weak edges.

## Open questions

- Should multiple watchlists per user ship in v1, or only a default list?
- How do we score relationship_weight when an edge has no observed evidence count?
- Do we need a "shared with team" mode at all, or is that a future plan?
- How does this interact with the parked `/personal` cockpit — keep them separate, or fold cockpit functionality into the watchlist surface?
