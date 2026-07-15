## Why

The company universe was requested as a high-quality accelerator-backed startup dataset, but the shipped artifact is dominated by broad VC portfolio aggregation. High Signal needs a deliberately bounded universe from Y Combinator, Antler, a16z, and Techstars so every inclusion has first-party provenance from a high-signal startup institution.

## What Changes

- Add source-backed ingestion for the official Y Combinator, Antler, and Techstars company directories.
- Retain only the official a16z investment list from the existing sources.
- Remove Sequoia, Bessemer, and VCBacked aggregator ingestion from this product dataset.
- Remove the fixed 2,200-company cap so every successfully fetched first-party source contributes to the artifact.
- Deduplicate companies while preserving all fund and accelerator affiliations and source evidence.
- Record source-level fetch and unique-company counts in the generated artifact so coverage regressions are visible.
- Add a public company search surface that answers name and "what does it do" queries across the frozen artifact.
- Turn each company's deterministic competitor graph into an explorable similar-company cluster.
- Guarantee that every displayed similar-company relationship is reciprocal: if A recommends B, B also recommends A.
- Add a manual build-time GLiNER enrichment pass for product capabilities, use cases, target customers, industries, and technologies; search and clustering consume these facets without runtime AI.
- Show the artifact's exact last-updated timestamp with search results; manual rebuilds remain the refresh model.
- Add focused parser and merge tests using checked-in HTML/JSON fixtures; live source failures must fail the build rather than silently erase a cohort.
- Regenerate the local company-universe artifact and update product/source documentation.

## Capabilities

### New Capabilities

- `accelerator-company-universe`: Build a provenance-preserving company universe exclusively from the official YC, Antler, a16z, and Techstars directories.

### Modified Capabilities

None.

## Impact

- Scripts: `scripts/build-company-universe.ts` and focused tests/fixtures.
- Generated web data: `apps/web/src/data/company-universe.json`, ranked `/case-studies/search`, and the existing `/case-studies` pages that read it.
- Persistence: the existing D1 sync schema and API remain compatible; no migration is required.
- Documentation: `PROJECT_STATUS.md`, source catalog documentation/data, and package scripts if a focused test command is added.
- External systems: official public YC, Antler, a16z, and Techstars directories are read during generation. No new dependency, credential, remote sync, deploy, or production migration is required.
