# Data Service Boundary

Status: phase 1 started
Updated: 2026-10-29

High Signal should remain the insight product, not the long-term data warehouse.
The current source adapters are useful and should stay working, but they are an
interim ingestion layer. The durable architecture is:

```text
Data substrate
  raw payloads
  normalized documents/source observations
  canonical URLs and dedupe
  source health
  entity resolution
  search/indexing
  historical backfills

High Signal
  candidate selection
  cross-source clustering
  cite-or-kill checks
  signal generation
  confidence and hit-rate
  Daily Brief and review surfaces
```

## Ownership Split

High Signal owns:

- signal rules: what changed, why it matters, who is affected
- evidence policy: source diversity, cite-or-kill, confidence bands
- synthesis: brief sections, convergence, opportunities, review queue
- track record: scored outcomes, hit-rate, source performance
- user/product surfaces

The data substrate owns:

- source-specific fetchers and credentials
- raw response storage
- source-specific parsed fields
- canonical document IDs and URL dedupe
- entity matching and enrichment
- backfill windows and replay
- document/event search
- source health and rate-limit state

## Current Repo Reality

### Stock-data consolidation

`python/ingest/src/high_signal_ingest/stock_data/` owns retained equity facts,
rights and deterministic valuation rules. `stock_data_collectors/` owns the
extracted SEC companyfacts collector, reviewed PDF extraction and attributed ECB
reference rates. The existing `equities_daily` job remains the sole equity-price
ingress. It retains return-adjusted prices separately from provider closes,
volumes and actions, then materializes `stock-data.prices.v1` for existing price,
market-context and equity-bundle consumers. Scoring reads retained history and
leaves incomplete forward windows pending.

The local SQLite ledger is a replay index. Migration `0033_stock_data.sql` stores
its immutable canonical records privately in D1 through `/admin/stock-data`.
Evidence bytes use content-addressed chunks; authenticated restore verifies their
original hashes. No raw-data artifact is uploaded to this public repository.
NSE collection is the entire daily CM security master and UDiFF final bhavcopy,
including SME and non-EQ series. `equities_daily --market nse` is the NSE branch
of the existing canonical ingress; its non-NSE branch excludes `.NS` tickers.
There is no 20-company or one-month NSE collection limit. Original compressed
files, every normalized master/observation row, and a versioned price contract
stay in the existing private R2 bucket under `stock-data/nse/v1/`. Deleted and
test records remain identified rather than being counted as active companies.
Master records without a daily observation retain null prices. Raw closes never
stand in for corporate-action-adjusted history or supported valuations.

`cron-equities` collects NSE files daily, including potential weekend special
sessions, with a late retry. The requested session must match the file's own trade date. A missing file,
network error, conflicting identifier or failed R2 receipt fails the job; it never
relabels yesterday's prices as today. Scheduled weekend attempts treat two
verified HTTP 404 responses as explicitly unpublished, leave latest unchanged,
and retry later; a single missing file, weekday miss or network failure stays red. Weekday expectations do not claim an
exchange holiday calendar; an unpublished holiday session is an explicit failed
attempt, with the prior snapshot visibly dated. Operator job summaries expose
failures. Every object is downloaded and hash-verified before the latest pointer
advances. Identical-input retries preserve the first observed availability time;
revisions receive immutable separate manifests. Historical downloads are first
available at observation time, not retrospectively on their economic date.

`nse_archive restore --root <private-dir> --out <canonical-prices.json>` verifies
and hydrates the underlying input contract. The non-NSE job waits for the NSE
job, restores that dataset and merges its versioned rows into the shared price
contract consumed by existing market/company builders and ticker matching.
Unknown rights keep numeric display withheld. A missing NSE archive explicitly
marks partial coverage without dropping old ticker identities or blocking other
markets. Stale inputs retain their original dates and a freshness status.
NSE public research Event/model assembly remains open; validating a readable
archive is not claimed as completed research migration.

Private full-market history does not create per-security daily D1 rows or inherit
the D1 inventory ceiling. Backfills upload and verify all objects while leaving a
newer latest pointer unchanged. Prior same-session versions cannot reassert as
current on a stale re-download. Writers serialize across workflow branches; failed
pointer acknowledgement attempts restore the previous pointer. Consumers verify
all object hashes independently. Historical objects can be read using a retained
manifest and an `as_of` cutoff; a Worker R2 binding/public historical API are not
implemented.

Non-NSE compatibility collection retains its existing optional bounded D1 mode
(`retain_global_history` dispatch input). Its 100,000-record/100 MiB replication
budget protects the separate small financial-fact ledger, not NSE coverage.
Restored chunks persist across separate processes, including interrupted writes.
Scoring traverses pending work with keyset pagination and counts one current
measurement per signal/window. A not-yet-provisioned history endpoint skips
scoring with an operator notice; other restore failures fail the job. Temporary
score gaps remain eligible for retry. NSE adjusted returns remain unavailable
until corporate actions are normalized. Rollback preserves private R2 objects,
additive tables and the local ledger; do not delete history.
A per-issuer SEC failure returns successful events with a partial-result error.
Deploy the migrated API before enabling D1 financial publication.

Materialized publications and their change-detection baselines stay private.
Restore obtains the prior publication from the authenticated API; no financial
snapshot is committed to public Git before or after the live rights gate.

`GET /v1/stock-data` reads the current permitted projection without a deployment
per data refresh. `?entity=...` retains the valuation's supporting entity facts;
`?export=1` applies independent export permissions. `?snapshot=...` pins the current
input snapshot ID and returns a conflict for another version. Historical snapshot
reads and the external TechData consumer are not yet qualified. Current source
rights are checked again on reads, including revocation before a new publication.
Company profiles load stock facts in the browser through a no-store proxy, so
ISR never retains numerical stock data or a prior rights decision. The research
adapter receives facts, dates, source references, snapshot IDs and
numerical changes. Editorial selection and existing publication gates stay in
High Signal. One source document never becomes multiple corroborating origins.

The free-source registry qualifies numeric SEC companyfacts under the
[SEC reuse policy](https://www.sec.gov/about/webmaster-frequently-asked-questions)
and ECB reference FX under its
[statistics usage policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html).
The scope excludes SEC artwork, trademarks and third-party licensed datasets.
A rights reversal needs a new dated decision; historical versions cannot silently
become current again. Public price display is withheld while Yahoo rights are
unknown. Previous numerical bundles remain retained verification inputs, while
public consumers honor the separate price-display status. Internal ticker
matching remains available from the canonical universe.

Current financial projections retain all reporting durations ending at the latest
reported date for each concept, unit and accounting scope. Earlier periods stay
in the ledger for as-of queries; the current research payload does not repeat a
company's full filing history.

Full NSE universe/price collection is separate from financial/ownership coverage.
Unknown rights and missing values
remain unavailable; carrying values are not market valuations. Partial NAV/SOTP
models cannot receive definitive discounts or rankings. Free access does not by
itself establish permission for public display or export.

Today, `python/ingest/src/high_signal_ingest/sources/` does both fetch and
normalization. Every adapter flattens source-specific data into the shared
`Event` shape:

- `source`
- `source_url`
- `published_at`
- `title`
- `content`
- `primary_entity_id`
- `raw_hash`

That shape is enough for signal generation, but it loses rich structure from
sources like SEC XBRL, Form D, USAspending, Podcast Index, and package
registries. Do not add dozens of source-specific columns directly to the signal
tables to compensate.

## Event naming contract

The physical D1 table remains named `events`, and Python adapters continue to
emit the `Event` type for compatibility. Semantically, both represent
**normalized source observations**: fetched filings, posts, releases, records,
quotes, or other source items. An `events` row is evidence input, not an
actionable product conclusion.

The actionable boundary starts with `SignalCandidate` and the D1 `signals`
table. Candidates are extracted interpretations awaiting product quality gates;
reviewed signals are the published, scored conclusions used by the Daily Brief
and track record.

There is no `normalized_events` table or type today. That name is reserved for
a future actionable-event model only if a concrete use case requires one. It
must not be used as an alias for the current `events` table. Adding it would be
a separately specified schema and migration change.

## Agent Access Boundary

The public REST API, OpenAPI document, JSON feeds, Markdown alternates, and MCP
server are interfaces over the same High Signal product data. They do not own a
second copy of signals or evidence.

`POST https://api.highsignal.app/mcp` uses stateless Streamable HTTP and exposes
eight read tools: `get_daily_brief`, `get_signal`, `get_daily_dump`,
`get_source_coverage`, `search_signals`, `browse_source`, `get_track_record`,
and `get_entity`. Those tools call the existing public Hono routes in-process
through the same Cloudflare Cache API wrapper. Publication gates,
Today/Yesterday access, and Turnstile-protected history therefore remain
identical across web, REST, and MCP. Tool schemas stay backward-compatible;
data can improve behind them without requiring agents to install a new
connector definition. Every tool response includes a `snapshotId` and
`reportingWindow` so agents can reconcile brief, exports, proofs, and MCP
responses against the same snapshot.

## Migration Path

Phase 1: keep adapters local, add raw-document preservation. **Started in
migration `0007_source_documents.sql`.**

- Add a `source_documents` / `source_payloads` store.
- Store canonical URL, source, fetched timestamp, raw hash, raw JSON/text, and
  parsed fields JSON.
- Let `events` reference the source document where possible.
- Keep `signals/YYYY-MM-DD/*.md` as the signal source of truth.

Current implementation:

- `source_documents` stores document-level payload fields without adding
  source-specific columns to signal tables.
- `events.source_document_id` points back to the preserved document.
- `/admin/events` writes a default source document from every incoming event.
- Python adapters can optionally attach `Event.source_document` when they have
  richer raw JSON or parsed fields worth preserving.
- Existing adapters do not need to change immediately; their flattened event
  payload still creates a minimal source document.
- Rich payload hooks are attached for the first high-structure adapters: SEC
  XBRL, Form D, USAspending/SBIR/SAM.gov, Podcast Index, and npm/PyPI releases.

Phase 2: separate ingestion execution.

- Move source fetchers and backfills behind a data-substrate API or service.
- High Signal consumes normalized documents/source observations, not source
  APIs.
- Keep source-quality audit in High Signal, but point it at the substrate output.

Phase 3: make High Signal an insight layer only.

- High Signal requests candidates by collection, entity, source role, and time
  window.
- Data substrate owns raw payload retention, dedupe, and replay.
- High Signal owns publication decisions and performance scoring.

## Non-Negotiables

- No second stock-price ingress. Equity, ETF, index, and crypto EOD prices stay
  behind the existing equities snapshot path until a dedicated market-data
  service replaces it.
- Prediction markets are not stock prices.
- Wayback/CDX and competitor page diffs belong to Mentionpilot until
  they have an explicit public-brief outcome metric.
- Raw data storage must not weaken cite-or-kill. Signals still need visible
  evidence and source diversity.

## Next Small Step

Use the preserved payloads to improve replay and de-duplication:

- compare structured source rows against the flattened `events` output
- collapse repeated evidence before confidence scoring
- expose source-health states (`fresh`, `stale`, `blocked`, `low-yield`,
  `duplicate-heavy`) in source audits
- bring up Lab only on the cheap path first: HN ingest, materialize, GitHub
  trending, cluster, and score. Keep embeddings, entity extraction, and
  summarization off until the basic feed proves useful.

Do not extract a new service before those steps prove the raw payload store helps
with replay, dedupe, or insight generation.
