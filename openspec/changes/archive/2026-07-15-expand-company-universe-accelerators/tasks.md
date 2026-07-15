## 1. Source And Merge Helpers

- [x] 1.1 Extract shared company-universe types, normalization, merge, and coverage validation into an importable helper module.
- [x] 1.2 Add pure parsers for YC Algolia responses, Antler portfolio cards, a16z investment-list HTML, and Techstars Typesense responses.
- [x] 1.3 Replace all-pairs competitor scoring with bounded affiliation, category, cohort, and keyword candidate indexes.

## 2. Official Source Orchestration

- [x] 2.1 Fetch YC's public directory configuration and retrieve every company by batch partition.
- [x] 2.2 Fetch every Antler Webflow portfolio page until official pagination ends.
- [x] 2.3 Retain official a16z ingestion and remove VCBacked, Sequoia, and Bessemer inputs.
- [x] 2.4 Fetch Techstars' public Typesense configuration and paginate every accelerator-company result.
- [x] 2.5 Write source statistics and required-source reconciliation into the artifact with no global target truncation.

## 3. Focused Verification

- [x] 3.1 Add compact source fixtures and parser/merge/coverage/competitor unit tests.
- [x] 3.2 Add and run a focused company-universe test command.
- [x] 3.3 Run the live four-source build and verify source counts, affiliations, deduplication, competitor bounds, and artifact size.
- [x] 3.4 Run the smallest relevant formatting and TypeScript checks.

## 4. Product Documentation

- [x] 4.1 Update source catalog data/docs to describe the four-source first-party boundary.
- [x] 4.2 Update `PROJECT_STATUS.md` with the expanded artifact counts and explicit removal of third-party/other-VC inputs.

## 5. Search And Freshness

- [x] 5.1 Add deterministic ranked search across name, description, category, affiliation, cohort/program, and location.
- [x] 5.2 Add focused search ranking tests for exact-name and descriptive queries.
- [x] 5.3 Add `/case-studies/search` and a search form on the company-universe index, reusing the existing result table.
- [x] 5.4 Show the artifact's exact UTC last-updated timestamp on the search surface.
- [x] 5.5 Extend the D1 `q` predicate to affiliation and source-evidence fields for future sync parity.
- [x] 5.6 Run focused tests, web typecheck, formatting, and rendered HTTP verification. The in-app visual browser was unavailable in this session.
- [x] 5.7 Update `PROJECT_STATUS.md` with the shipped search behavior and manual-refresh model.

## 6. Similar-company Discovery

- [x] 6.1 Add common YC and a16z affiliation aliases to lexical search.
- [x] 6.2 Add cached deterministic lexical indexes and focused tests that resolve artifact-backed product-similarity clusters.
- [x] 6.3 Render rich similar-company clusters on company detail pages with descriptions, match reasons, and onward links.
- [x] 6.4 Verify Screenpipe is present from first-party YC evidence rather than adding a manual row.
- [x] 6.5 Prefer a bounded richer official YC description so product similarity is not limited by one-line summaries.
- [x] 6.6 Add a manual GLiNER company-facet pass using the existing ingest dependency and record reproducibility metadata.
- [x] 6.7 Consume extracted facets in search and local similarity ranking, following Starboard's structured-metadata reranking pattern.
- [x] 6.8 Rebuild and enrich the full local artifact, then verify Screenpipe's resulting cluster.

## 7. Reciprocal Similarity Graph

- [x] 7.1 Extract reusable candidate scoring and add a deterministic bounded reciprocal-graph builder.
- [x] 7.2 Add a manual materialization command that writes the symmetric graph and reproducibility metadata into the artifact.
- [x] 7.3 Add unit and full-artifact regression tests for A → B → A reciprocity, equal edge metadata, and the peer cap.
- [x] 7.4 Materialize the current artifact, verify the clicked-company back-link over HTTP, and update `PROJECT_STATUS.md`.
- [x] 7.5 Reject cross-category edges supported only by common prose and regression-test the observed Clarum/Platzi false positive.
