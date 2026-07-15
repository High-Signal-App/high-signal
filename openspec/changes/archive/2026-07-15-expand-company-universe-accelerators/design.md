## Context

`scripts/build-company-universe.ts` currently combines one official a16z page, official Bessemer and Sequoia pages, and VCBacked directory pages, stops near a configurable 2,200-row target, then performs an all-pairs competitor scan. That design both misses the requested accelerator cohorts and cannot scale cleanly to the roughly 10,000+ unique companies exposed by YC, Antler, a16z, and Techstars.

All four selected institutions expose public first-party directory data without operator credentials:

- YC publishes its directory through a restricted public Algolia search key embedded in the official companies page.
- Antler renders 100 portfolio cards per official Webflow page with deterministic pagination.
- a16z publishes its official investment list as HTML.
- Techstars publishes its official accelerator portfolio through a read-only Typesense key embedded in the official portfolio page.

The generated JSON remains the current crawlable cache for `/case-studies`; D1 remains the persistent product store after an explicit sync.

## Goals / Non-Goals

**Goals:**

- Build exclusively from official YC, Antler, a16z, and Techstars directory surfaces.
- Preserve cohort/program and source-page evidence where the source provides it.
- Merge cross-program duplicates without dropping affiliations.
- Fetch complete directories rather than an arbitrary global target count.
- Make source coverage observable and fail loudly on implausibly empty or truncated results.
- Keep competitor mapping useful at the larger dataset size.
- Let an operator search the frozen universe by company identity, description, category, affiliation, cohort/program, or location.
- Show snapshot freshness honestly without adding scheduled refresh work.
- Let an operator move from a discovered company into a compact cluster of its strongest similar peers.

**Non-Goals:**

- Remote D1 sync, production migration, deploy, or release.
- Scraping private founder/contact data.
- Enriching every company from its own website.
- Fuzzy entity resolution across unrelated companies with similar names.
- Adding other accelerators or investors in this change.
- Semantic/vector retrieval, LLM query rewriting, or automatic background refresh.

## Decisions

### Use first-party public search clients as page-backed sources

The builder will first fetch each official directory page and extract the public read-only client configuration used by that page. It will then query the same official backing search service. This avoids checked-in tokens and lets a changed or revoked public key fail explicitly.

- YC: fetch the batch facet, then query every batch independently. Each batch is below Algolia's 1,000-hit query ceiling, allowing complete coverage without a privileged browse key.
- Techstars: paginate the `companies` Typesense collection with `is_accelerator_company:=true` until the reported `found` count is reached.
- Antler: request Webflow pages sequentially until the next-page link disappears, parsing the rendered company cards.
- a16z: retain the existing official investment-list parser, but remove all VCBacked, Sequoia, and Bessemer inputs.

Alternative considered: use third-party portfolio datasets for easier bulk access. Rejected because the user explicitly prioritized a smaller, higher-quality source boundary and third-party affiliation drift caused the original mismatch.

### Extract pure parsers and merge helpers

Source response parsing, company merging, and coverage validation will live in an importable helper module. The executable builder will own network orchestration and artifact writing. Tests will exercise pure helpers with compact fixtures and no live network requirement.

Alternative considered: keep the monolithic script and test only a live build. Rejected because live HTML/search responses are slow and cannot isolate parser regressions.

### Preserve compatibility while enriching evidence

The existing `investors` array remains the affiliation field consumed by the web, API, sync script, and D1 schema. Values will be the canonical institution labels `Y Combinator`, `Antler`, `Andreessen Horowitz`, and `Techstars`. `sourceEvidence` may additionally carry optional `cohort`, `program`, `location`, and `website` values. This is backward-compatible JSON and needs no migration.

### Replace all-pairs competitor scoring with bounded candidate indexes

The builder will index companies by affiliation, inferred category, and meaningful keyword. Each company will score only the union of candidates from those indexes, capped before final ranking. This preserves the existing deterministic reasons while avoiding quadratic work over the full universe.

### Treat coverage collapse as a build failure

Each first-party source must return at least one valid company, fetched counts must reconcile with provider-reported totals where available, and the final artifact must contain every required affiliation. `sourceStats` will record fetched evidence, unique company count, and provider-reported count. Partial network/parser failures will exit non-zero rather than write a misleading smaller artifact.

### Search the static artifact on the server

`/case-studies/search?q=` will rank the imported artifact on the server and return the top 50 matches. Exact/prefix company-name matches rank first; token coverage across description, category, affiliation, cohort/program, and location provides discovery for queries such as "AI workflow finance". The result page will reuse the existing company table and show `generatedAt` as the last-updated time.

The browser receives only the rendered result set, not the 27.8 MB source artifact. The D1 list endpoint will include affiliation and source-evidence JSON in its existing `q` predicate so a future synced deployment has field parity.

Alternative considered: ship a client-side search index. Rejected because it would transfer a large payload and duplicate ranking logic. Vector or LLM search is also rejected because the repo explicitly defers vector retrieval on public surfaces and lexical metadata is sufficient for this directory.

### Expose local product-similarity clusters from bounded lexical indexes

Each company detail page will treat the company as an anchor and resolve its strongest product-description matches into an explorable peer cluster. A cached inverted index over meaningful description terms and a small set of explicit product themes bounds the work across the full artifact. Category and selected-institution affiliation may strengthen a product match but cannot create one by themselves. Peer cards will show what the company does and the deterministic match reason, not just a company name. This keeps clusters specific to the operator's discovery path and avoids giant connected components caused by broad categories or shared accelerator affiliation. The generated competitor edges remain a fallback for sparse records that have no usable lexical match.

The search index will recognize the common `YC` and `a16z` aliases in addition to canonical affiliation names. Screenpipe is already present through YC first-party evidence, so no manual or unsourced company row is required.

YC records will retain the richer of the official one-line and long descriptions, bounded to 500 characters. This supplies enough product language for discovery and similarity without fetching or embedding every company website.

Alternative considered: precompute one global cluster assignment for all companies. Rejected because current source descriptions are short and uneven, and broad graph connectivity would produce misleading mega-clusters. Local clusters keep the anchor and the reason for each relationship explicit.

### Materialize reciprocal similarity edges after enrichment

Directional top-k lists are not a stable exploration graph: A may rank B in its first six while B has six stronger candidates, so clicking A → B loses the path back to A. After entity enrichment, a manual TypeScript pass will score a bounded candidate pool for every company, deduplicate those pairs into undirected edges, rank edges globally, and greedily materialize them only while both endpoints remain below the six-peer degree cap. The resulting edge is written to both companies with the same score and reason.

The web will prefer this materialized reciprocal graph and retain the current request-time scorer only as a compatibility fallback for artifacts built before the reciprocal pass or D1 lookup-created rows. This moves the heavier whole-universe work to manual refresh time, keeps request latency bounded, and makes the exploration invariant testable.

Alternative considered: show each company's top six plus every inbound recommendation. Rejected because popular hubs can accumulate unbounded peer lists. Mutual-top-six intersection was also rejected because it can leave good companies with empty clusters merely because one endpoint has a denser neighborhood.

### Follow Starboard's structured-metadata reranking pattern

Starboard does not rely on NER alone: semantic candidates are reranked with structured category, topics, use cases, keywords, and lexical overlap. High Signal will adopt the smallest compatible part of that pattern without adding runtime vectors to the public surface. A manual GLiNER pass uses the existing ingest dependency to extract bounded product capabilities, use cases, target customers, industries, technologies, and products from the preserved official descriptions. These facets become searchable and strengthen product-similarity scores.

The enrichment metadata records its own model, labels, threshold, counts, completion state, and UTC timestamp. The pass remains explicitly manual and runs after the four-source artifact build. No request-time model, credential, new dependency, or automatic schedule is introduced.

## Risks / Trade-offs

- [Public search contracts or HTML change] -> Parse client configuration from the official page, keep fixtures for expected shapes, validate minimum/reported counts, and fail instead of silently shrinking.
- [Name-only deduplication merges two distinct companies] -> Keep the existing conservative normalized-name/slug key in this change; retain all evidence so ambiguous merges are auditable. Domain-aware identity can be a separate change.
- [Large generated JSON increases repository and build weight] -> Keep descriptions concise where a source offers both short and long forms, generate only six competitors per company, and report artifact size during verification.
- [Official directories contain inactive or acquired companies] -> Include them because the contract is institutional backing, not current operating status; preserve available status/cohort evidence for later filtering.
- [Program affiliation is stored in a field named `investors`] -> Preserve schema compatibility now; treat a semantic rename as a future migration if the company-universe surface becomes a primary product.
- [Lexical search misses synonyms] -> Rank all descriptive metadata consistently and keep the implementation replaceable; do not add AI/vector infrastructure until observed queries prove the need.

## Migration Plan

1. Add and test pure source parsers, merge logic, coverage validation, and indexed competitor mapping.
2. Switch the builder to the four official sources and regenerate the local JSON artifact.
3. Verify source counts, deduplication, sample cross-affiliations, typechecks, and focused tests.
4. Update `PROJECT_STATUS.md` and source catalog documentation.
5. Materialize the bounded reciprocal similarity graph after entity enrichment.
6. Do not sync D1 remotely or deploy. The existing artifact can be restored from version control if generation quality is unacceptable.

## Open Questions

None. The user selected the four-source quality boundary: YC, Antler, a16z, and Techstars.
