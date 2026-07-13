## Context

Plan 0012 already owns intent discovery, persistence, evidence-task linking,
Mentions UI, and report output. The missing link is the owner-scoped Daily Brief
composer: section 4 currently reads only completed mention checks and section 5
only reads Agent Eval tasks. Migration 0014 is additive but is still absent in
production, so brief composition must remain backward-compatible while local
acceptance is verified.

## Goals / Non-Goals

**Goals:**

- Make one intent finding per brand visible beside section 4 perception metrics.
- Turn actionable intent findings into cited section 5 next actions.
- Preserve existing personal brief output when intent storage is unavailable.
- Keep the web and delivery renderers aligned with the shared snapshot contract.
- Prove migration 0014 against an isolated local D1.

**Non-Goals:**

- Remote migration, deployment, or production configuration.
- New intent discovery, scoring, reply generation, routes, or tables.
- Auto-posting replies or changing intent status from the Daily Brief.
- Adding new dependencies or broadening `/communities` into a product surface.

## Decisions

### Add one shared intent summary type

Introduce a `BriefIntentItem` in the shared brief contract and attach it
optionally to perception and improvement items. This avoids inventing a second
scoring vocabulary and gives web/email renderers the same source-backed object.

Alternative considered: encode intent in existing task/headline strings. That
would lose source identity, stage, score, competitor context, and reliable
deduplication.

### Query intent as an independent personal-section builder

The owner path will query open intent rows separately from mention and Agent
Eval builders, then merge with pure functions. The intent builder is wrapped by
the existing section-level fault boundary. A missing table therefore yields an
empty enrichment set without erasing valid mention or Agent Eval output.

Alternative considered: query intent inside `buildPerception` and
`buildImprovements`. That couples migration availability to existing output and
could turn a missing additive table into a personal-brief regression.

### Reuse source URLs as the deduplication key

Existing evidence tasks already persist the originating `source_url`. Section
5 will carry that field into its shared item and suppress a derived intent action
when an existing open task has the same canonical stored URL. Intent items with
no matching task become concise actions using their existing action type and
score-derived priority.

Alternative considered: deduplicate by title. Titles are mutable and can collide
across sources; the persisted intent model already treats brand plus source URL
as its identity.

### Keep intent interaction in the Mentions lens

Brief items link to `/mentions/<brand>?tab=intent` and to the original source.
The Daily Brief remains a read-only synthesis surface; drafting, dismissing, and
marking done stay in the established Mentions workflow.

## Risks / Trade-offs

- **Cached snapshots predate the optional fields** → New fields are optional and
  renderers tolerate their absence.
- **Migration 0014 is missing remotely** → Intent loading is independently
  fail-soft; existing sections remain unchanged until the operator applies it.
- **Multiple opportunities can flood section 5** → Rank by persisted score,
  retain only a small bounded set, and deduplicate evidence-backed tasks.
- **URL-equivalent sources with different query strings may duplicate** → Use
  the persisted source URL identity for this slice; canonicalization can remain
  in ingestion rather than adding brief-specific behavior.

## Migration Plan

1. Apply `0014_intent_opportunities.sql` only through Wrangler's local D1 mode
   with a worktree-specific persistence directory.
2. Inspect SQLite metadata for the table and all three indexes.
3. Land the fail-soft code and tests without touching remote state.
4. Leave remote migration as an explicit operator gate documented in
   `PROJECT_STATUS.md`; rollback is simply omitting enrichment because all new
   contract fields are optional.

## Open Questions

None for the local acceptance slice. Production migration timing remains an
operator decision.
