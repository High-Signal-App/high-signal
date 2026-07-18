# Borrowed Patterns From `last30days` (archived)

> Archived from `docs/operations/data-source-audit.md` (2026-07-18) to keep that
> page under the 150–300 line target. Research-workflow notes, not a live
> dependency. Retained for provenance.

The `mvanhorn/last30days-skill` repo is useful as a research workflow, not as a
High Signal dependency. We should steal the operating patterns that improve
signal quality while keeping High Signal's source-of-truth model intact.

Adopted:

- **Availability before yield**: first diagnose whether credentials/tools are
  present, then run source-yield audits. Use `pnpm source:diagnose` before
  `pnpm source:quality` when a source looks empty.
- **Recent-window first**: optimize for the last 28-30 days before building
  bigger archives. Historical backfills should prove they improve hit-rate or
  replay value.
- **People-weighted attention, not SEO**: Reddit, HN, GitHub issues, YouTube,
  and prediction markets are useful because they carry engagement, comments,
  issue velocity, or money-at-risk. Preserve those measures as context when
  adapters expose them.
- **Raw evidence trail first**: keep raw source documents and raw/source URLs
  durable enough for replay. Generated briefs and JSON bundles are derived
  artifacts, not canonical source truth.
- **Cross-source clustering**: merge repeated stories across source families
  before synthesis so one story does not appear as many independent insights.

Rejected for High Signal core:

- Do not import `/last30days` as a production dependency.
- Do not add broad social firehoses just because the skill supports them.
- Do not store its local markdown/SQLite outputs as High Signal source truth.
- Do not let social/community engagement publish alone; it remains weak signal
  unless corroborated by independent evidence or hit-rate history.
