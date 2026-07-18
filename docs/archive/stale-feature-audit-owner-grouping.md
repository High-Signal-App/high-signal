# Feature grouping by likely owner (archived)

> Archived from `docs/product/feature-audit.md` (2026-07-18) to keep that page
> under the 150–300 line target. Forward-looking service-split analysis, not a
> committed plan. The locked decision (`agents.md`, `docs/product/direction.md`)
> is **one product, lenses not deployables** — treat this as a thought exercise.

## Keep in High Signal core

- Daily brief composition and web surface.
- Signals, evidence, review status, markdown signal memory, and D1 sync.
- Track record, score runs, hit-rate families, and public ledger.
- Entity read model and relationship/spillover view.
- Cite-or-kill and auto-publish rules.
- RSS/Atom/weekly digest if brief distribution remains in scope.

## Candidate "source/data pipeline" service or module

- Source adapters under `python/ingest/src/high_signal_ingest/sources`.
- `source_documents`, current `events`, and `ingest_runs`.
- Source registry, source quality, source audit, source health pages.
- Gazetteer/unmapped candidate generation.
- Raw source TTL/retention policy.
- Backfills and source-specific credentials/rate limits.

This split would make High Signal consume already-normalized observations/actionable events instead of owning every fetcher.

## Candidate "market data" service or module

- `tickers`, `closes`, `ticker_snapshot`, `index_memberships`, `fx_rates`, `risk_free_rates`, `institutional_holders`, `insider_transactions`.
- Equity snapshot builders and market snapshot builders.
- `/equities`, parts of `/markets`, and market/equity cron workflows.

This is the clearest data-volume boundary. It prevents price/time-series logic from crowding source-document and signal logic.

## Candidate "brand intelligence" product/module

- Mentions configs/prompts/checks/results.
- Agent-evaluation audits/responses/scores/tasks.
- SEO audit.
- Reel briefs.
- Brand badge/widget/report surfaces.

This area is valuable, but it is a different product shape from public data aggregation and prediction. It can still feed brief sections 4 and 5 through a narrow API.

## Candidate "Lab/search substrate"

- `python/lab` Postgres/pgvector system.
- Local feed/search/stats server.
- Lab candidate review bridge.

This already has a separate DB and runtime. Keep it separate unless the product explicitly needs integrated search now.

## Candidate "operator cockpit"

- `/daily/*`, `/personal`, source requirements queue, personal command brief, task exports.
- Local JSON snapshots and personal source registry.

These can stay while the operator is the first user, but they should be labeled internal so they do not confuse product boundaries.
