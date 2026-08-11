## Why

High Signal currently presents one strong daily edition but leaves slower-moving opportunity, behavior, and accountability material inside the same reading path. Readers need a small set of named feeds whose cadence matches how quickly the underlying evidence becomes useful, while retaining one obvious homepage and one evidence contract.

## What Changes

- Introduce a bounded feed registry with a public default cadence and explicitly supported cadences for each feed.
- Keep the mixed Daily Brief as the canonical root edition and add focused Markets & Companies, Opportunity Radar, and Behavior & Culture feeds.
- Build weekly and monthly editions as deterministic, de-duplicated rollups of already accepted daily snapshots or scored outcomes; do not generate uncited replacement narratives.
- Add a compact publication switcher near the top of the reading surface for feed and cadence selection.
- Add Brief and Newspaper presentation modes that render the same edition data and links; remember the layout preference locally without changing public content, canonical URLs, or shared edge-cache eligibility.
- Preserve dated daily snapshots as immutable source records. Period rollups disclose their date window and link back to contributing daily editions.
- Add a machine-readable public-data parity baseline for the reference products already discussed, plus an edition coverage receipt that distinguishes configured source classes from those actually contributing evidence.
- Fail parity checks when a capability marked covered loses every mapped High Signal source, while keeping premium, proprietary, or access-restricted gaps explicitly partial.

## Capabilities

### New Capabilities

- `cadenced-brief-feeds`: Defines the feed catalog, supported cadences, rollup semantics, routes, archive provenance, and honest unavailable/empty states.
- `brief-reading-layouts`: Defines the Brief/Newspaper presentation toggle as a layout-only, accessible, locally remembered preference.
- `feed-data-coverage`: Defines verifiable public-data parity, reference provenance, edition-level coverage receipts, and honest partial-gap disclosure.

### Modified Capabilities

- `daily-brief-reader-path`: Extends the current-edition reading path with a subordinate feed/cadence switcher while preserving the Daily Brief as the public starting point.

## Impact

- Web: current brief hero, section rendering, a feed/cadence route, layout preference control, responsive editorial layouts, metadata, and archive links.
- API/shared: a typed feed registry and a bounded period-rollup read endpoint over `daily_brief_snapshots` and existing track-record data.
- Data governance: a tested parity manifest mapped to the generated source catalog, with official reference URLs and explicit unsupported premium/restricted classes.
- Storage: no migration is expected; accepted daily snapshots remain canonical and weekly/monthly editions are computed from a bounded date range.
- Caching: feed and cadence are shareable route inputs; the layout preference is client-local so cached public payloads are not personalized.
- Operations: no new source adapters, scheduled jobs, production dependencies, or publication gates.
