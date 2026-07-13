# Plan 0008 - Signal Provenance Editor And Claim Ledger

Status: implemented
Created: 2026-06-12
Last updated: 2026-07-13
Depends on: `plans/0004-platform-consolidation.md`, `plans/0006-agent-evaluation-attention-layer.md`, `plans/0007-highsignal-lab-substrate.md`

## Implementation state

This PRD is complete as a product spec and accepted into active scope. The v1 scaffold now exists:

- D1 migration `packages/db/migrations/0009_claim_provenance.sql`.
- Shared claim/evidence rollup helpers in `packages/shared/src/claim-provenance.ts`.
- Public read routes: `GET /claims/:id` and `GET /claims/by-signal/:slug`.
- Admin write routes: `POST /admin/claims`, `POST /admin/claims/:id/evidence`, `DELETE /admin/claims/:id/evidence/:linkId`, `POST /admin/claims/:id/status`, `POST /admin/claims/:id/corrections`.
- Inline `/review` provenance editor with role-tagged evidence and correction/status actions.
- Public signal-detail provenance section on `/signals/[slug]`.
- Auto-publish reads structured claim evidence when available and reports the explicit legacy-signal fallback while historical coverage backfills.
- Opening provenance in `/review` lazily creates one deterministic historical claim with role-tagged evidence through an authenticated idempotent route.
- Stock items in `/brief` expose an optional compact "why this is here" claim/evidence disclosure.
- Unit coverage in `scripts/claim-provenance.test.ts`.

Migration `0009_claim_provenance.sql` was applied to remote D1 on 2026-06-28. No migration or deploy was run as part of the 2026-07-13 local-code completion.

## Thesis

High Signal already tracks evidence bundles and shows cited claims. The missing product is a first-class editing surface for claim provenance: every public assertion should be traceable, reviewable, and reproducible from the exact evidence that justified it.

The signal moat is not just "we cite sources." It is "we can explain why this claim exists, when it was created, what changed it, and which evidence pieces were decisive." Provenance becomes the spine of `/review`, the brief, and the public hit-rate ledger.

## Product contract

Input:
- a signal card, brief section item, or agent-eval output
- one or more evidence URLs or `source_documents` rows
- optional claim text and confidence band

Output:
- canonical `claim_record`
- per-claim provenance timeline
- evidence contribution breakdown (role + weight)
- conflicting-evidence warnings
- review state (`draft | held | published | killed | corrected`)
- correction lineage (claim version chain)

## Target user

- Review operators on `/review` who must decide whether a claim should publish.
- Internal editors who later need to explain why a claim existed.
- Operators who want to defend a signal to a teammate without losing the source trail.

Out of scope as a user: external readers of the public brief. Provenance is exposed in compact form on signal detail pages, but the editor is internal.

## User stories

1. As a reviewer, I open a draft signal, see the atomic claims it makes, and confirm each has ≥ 2 cited evidence URLs before publish.
2. As a reviewer, when a contradiction is flagged on an evidence link, I can see which other links it conflicts with and resolve it (downgrade, mark "context only", or drop the claim).
3. As an editor revisiting a published claim three months later, I can read the timeline: who/what created it, what evidence carried weight, and any corrections that came after.
4. As an operator filing a correction, I create a new claim version pointing at the original; the original is never mutated.
5. As an auto-publish judge (`scripts/auto-publish-drafts.ts`), I can read the structured claim record and apply rules consistently (cite-or-kill floor, prediction-market-only kill, etc.).

## Core workflow

1. A signal draft (markdown frontmatter, or agent-eval output, or brief snapshot item) is ingested.
2. The provenance editor resolves the draft into one or more atomic assertions (a sentence-sized claim with a verb and a subject entity).
3. Each assertion gets evidence links with a role:
   - `primary` — the assertion would not stand without it
   - `corroboration` — independent confirmation
   - `contradiction` — directly refutes the assertion
   - `context` — background, not weight-bearing
4. The reviewer marks a "why this ships" line: the rule that justified publish (e.g. `≥2 primary`, `1 primary + 2 corroboration`, `expert-judge override`).
5. On publish, the claim record is frozen. Any later change is a new claim version with `parent_claim_id` set; never an in-place edit.
6. If contradictory evidence later appears, the editor produces a `correction` claim version with role-tagged links to both old and new evidence.

## Data model (D1)

New tables in a single migration `0009_claim_provenance.sql`:

```sql
CREATE TABLE `claim_records` (
  `id` text PRIMARY KEY NOT NULL,
  `signal_id` text,                -- nullable: claims can attach to brief/agent-eval too
  `brief_item_id` text,            -- composed brief section item slug
  `agent_eval_response_id` text,
  `surface` text NOT NULL,         -- 'signal' | 'brief' | 'agent_eval'
  `assertion` text NOT NULL,       -- sentence-form atomic claim
  `confidence_band` text NOT NULL, -- 'low' | 'medium' | 'high'
  `review_status` text NOT NULL DEFAULT 'draft', -- draft|held|published|killed|corrected
  `publish_reason` text,           -- which rule allowed publish
  `parent_claim_id` text,          -- correction lineage
  `version` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `published_at` integer,
  `corrected_at` integer,
  FOREIGN KEY (`parent_claim_id`) REFERENCES `claim_records`(`id`)
);
CREATE INDEX `claim_records_signal_idx` ON `claim_records`(`signal_id`);
CREATE INDEX `claim_records_parent_idx` ON `claim_records`(`parent_claim_id`);
CREATE INDEX `claim_records_surface_idx` ON `claim_records`(`surface`, `review_status`);

CREATE TABLE `claim_evidence_links` (
  `id` text PRIMARY KEY NOT NULL,
  `claim_id` text NOT NULL,
  `evidence_url` text NOT NULL,
  `source_document_id` text,        -- nullable; links to source_documents when known
  `role` text NOT NULL,             -- primary|corroboration|contradiction|context
  `weight` integer NOT NULL DEFAULT 1,
  `notes` text,
  `added_at` integer NOT NULL,
  `added_by` text,
  FOREIGN KEY (`claim_id`) REFERENCES `claim_records`(`id`)
);
CREATE INDEX `claim_evidence_claim_idx` ON `claim_evidence_links`(`claim_id`);
CREATE INDEX `claim_evidence_url_idx` ON `claim_evidence_links`(`evidence_url`);
CREATE INDEX `claim_evidence_doc_idx` ON `claim_evidence_links`(`source_document_id`);

CREATE TABLE `claim_timeline_events` (
  `id` text PRIMARY KEY NOT NULL,
  `claim_id` text NOT NULL,
  `kind` text NOT NULL,             -- created|evidence_added|evidence_removed|status_change|correction_filed
  `payload` text NOT NULL,          -- json
  `actor` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`claim_id`) REFERENCES `claim_records`(`id`)
);
CREATE INDEX `claim_timeline_claim_idx` ON `claim_timeline_events`(`claim_id`, `created_at`);
```

Backfill rule: existing `signals` + `evidence` rows are imported lazily on first open in `/review`, not in a one-shot script.

## API surface (worker)

Read routes live under `workers/api/src/routes/claims.ts`:

- `GET /claims/:id` — full claim record + evidence links + timeline.
- `GET /claims/by-signal/:slug` — list claims attached to a signal.

Write routes live under `workers/api/src/routes/admin.ts` so the existing Clerk/admin proxy protects mutations:

- `POST /admin/claims` — create draft claim from a signal/brief/agent-eval reference.
- `POST /admin/claims/:id/evidence` — add evidence link with role.
- `DELETE /admin/claims/:id/evidence/:linkId` — remove an evidence link.
- `POST /admin/claims/:id/status` — transition (`draft` → `held | published | killed`).
- `POST /admin/claims/:id/corrections` — create a new claim version with `parent_claim_id`.

Potential future read routes, if the brief affordance needs them:

- `GET /brief/items/:id/claims` — list claims attached to a brief item.

Auto-publish integration: `scripts/auto-publish-rules.ts` reads the structured claim record; the cite-or-kill floor (`< 2` evidence) and prediction-market-only kill now operate on `claim_evidence_links` rolls instead of free-form evidence arrays.

## Web surface

`/review` enhancements:
- Inline claim list per draft signal, with role-tagged evidence chips.
- Action bar: add evidence URL, change role, set status, file correction.
- Conflict banner when any link has `role='contradiction'` and no resolution note.

`/signals/[slug]` enhancements:
- "Provenance" tab showing claim list, timeline, and correction chain.
- Public version: assertion text + evidence role badges + version label. Internal-only fields (publish_reason, actor) hidden behind admin gate.

`/brief` enhancements (light touch):
- Each brief item carries a "why this is here" affordance — a hover/click that surfaces the underlying claim's evidence roles. No new page.

## Telemetry

- `claim.created`, `claim.published`, `claim.killed`, `claim.corrected`
- `evidence_link.added` with `role` dimension
- `provenance.review_seconds` — time from open to publish/kill decision
- `auto_publish.rule_applied` with `rule_key` dimension (cite_or_kill, market_only, fallback_backfill, hold_to_kill)

Watch the share of `evidence_link.role=primary` over time; if it collapses to <50% of all links, the editor is being used as a notes app — tighten the UI.

## Rollout slice

1. Migration + worker routes + minimal `/review` editor. Operate on new drafts only.
2. `/signals/[slug]` provenance tab (public version).
3. Auto-publish rule rewrite to read `claim_records`. Keep legacy free-form rules as fallback for two weeks, then remove.
4. Brief item provenance affordance.
5. Backfill: top 50 most-trafficked published signals, on-demand on first view.

## Scope

### Add
- `claim_records`, `claim_evidence_links`, `claim_timeline_events` in D1.
- Worker routes under `/claims/*`.
- Provenance editor on `/review`.
- Claim timeline on signal detail pages.
- Import path from signal markdown frontmatter and agent-eval outputs.
- Correction flow that spawns a new linked claim version.

### Keep out
- General-purpose annotation on every page in the app.
- Full Google-docs-style comment threads.
- Arbitrary freeform notebook behavior.
- A separate admin app — this lives inside `/review`.

## Dependencies

- Existing `evidence`, `source_documents`, `signals` tables.
- Review queue state transitions (already supports draft/published/corrected/killed).
- Shared claim IDs reachable from brief snapshots and agent-eval responses.
- `auto-publish-rules.ts` refactor to read structured claim records.

## Acceptance criteria

- Any published signal claim can show its supporting evidence chain in <3 clicks from `/signals/[slug]`.
- Corrections appear as new claim versions; original record is never mutated (verified by a row-level audit).
- Reviewers can distinguish `primary`, `corroboration`, `contradiction`, and `context` roles in the editor.
- The editor is reachable from `/review` without a separate admin route.
- A reviewer can answer "why did this ship?" in under a minute from the claim record alone.
- The provenance trail survives a correction without mutating the original evidence set.
- `auto-publish-drafts.ts` reads `claim_records` and applies cite-or-kill at the link level, not the free-form array level.

## Non-goals

- Replacing markdown signal memory under `signals/YYYY-MM-DD/` — the markdown remains canonical for human reading; claim records are the structured index.
- Cross-claim merging or canonicalization.
- Public editing UI; provenance is internal-only beyond the read-only badges on signal pages.

## Risks

- Too much UI slows the review flow. Mitigation: keep the editor inline in `/review`, no second screen.
- Over-modeling evidence roles creates needless ceremony. Mitigation: ship with four roles, resist a fifth until evidence shows a real gap.
- Backfill effort balloons. Mitigation: lazy import on first view, no batch migration.

## Open questions

- Should `claim_records` carry an entity reference for graph rollups, or rely on the signal-level entity?
- Do we need a "supersedes" relation distinct from `parent_claim_id` (correction vs. update vs. expansion)?
- Where does Lab fit in — can Lab documents become first-class `source_document_id` references without re-ingesting?
