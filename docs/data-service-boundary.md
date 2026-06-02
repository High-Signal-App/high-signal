# Data Service Boundary

Status: phase 1 started
Updated: 2026-06-02

High Signal should remain the insight product, not the long-term data warehouse.
The current source adapters are useful and should stay working, but they are an
interim ingestion layer. The durable architecture is:

```text
Data substrate
  raw payloads
  normalized documents/events
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

Phase 2: separate ingestion execution.

- Move source fetchers and backfills behind a data-substrate API or service.
- High Signal consumes normalized documents/events, not source APIs.
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
- Wayback/CDX and competitor page diffs belong to Mention / Agent Eval until
  they have an explicit public-brief outcome metric.
- Raw data storage must not weaken cite-or-kill. Signals still need visible
  evidence and source diversity.

## Next Small Step

Attach richer `Event.source_document` payloads to the highest-structure
adapters first: SEC XBRL, Form D, USAspending, Podcast Index, and package
registries. Do not extract a new service before those adapters prove the raw
payload store helps with replay, dedupe, or insight generation.
