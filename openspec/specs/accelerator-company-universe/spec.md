# Accelerator Company Universe

## Purpose

Define the first-party company directory, search, enrichment, freshness, and reciprocal similarity behavior used to discover startups from YC, Antler, a16z, and Techstars.

## Requirements

### Requirement: The universe has an explicit first-party source boundary

The builder SHALL generate companies exclusively from the official Y Combinator, Antler, Andreessen Horowitz, and Techstars directory surfaces.

#### Scenario: A normal build completes

- **WHEN** all four official directory sources return valid data
- **THEN** the artifact lists exactly those four institutions as its source boundary
- **AND** no VCBacked, Sequoia, or Bessemer source evidence is present

### Requirement: Complete source cohorts are fetched

The builder SHALL paginate or partition each official directory until every publicly reported company record available through the directory contract has been processed.

#### Scenario: A provider returns more records than one page allows

- **WHEN** YC, Antler, or Techstars reports additional batches or pages
- **THEN** the builder fetches them before writing the artifact
- **AND** it does not stop because a global target count was reached

### Requirement: Cross-source provenance is preserved

The builder SHALL merge duplicate normalized companies while retaining every matched institution affiliation and source-evidence record.

#### Scenario: A startup belongs to two selected institutions

- **WHEN** the same normalized company appears in two source directories
- **THEN** the output contains one company profile
- **AND** both affiliations and both source records remain visible

### Requirement: Coverage regressions fail loudly

The builder MUST reject a run when a required source is empty, pagination is incomplete against a provider-reported count, or a required affiliation is absent from the final artifact.

#### Scenario: An official page changes markup

- **WHEN** a source parser returns no valid companies or an implausibly partial result
- **THEN** the command exits non-zero
- **AND** it does not replace the existing artifact with the partial build

### Requirement: Coverage is measurable

The generated artifact SHALL include per-source fetched, unique-company, and provider-reported counts where the provider exposes a total.

#### Scenario: An operator audits a generated artifact

- **WHEN** the operator reads artifact metadata
- **THEN** they can see the contribution and reconciliation status of YC, Antler, a16z, and Techstars without scanning every company row

### Requirement: Competitor mapping scales with the expanded universe

The builder SHALL generate deterministic competitor mappings from bounded affiliation, category, cohort, and keyword candidate sets rather than comparing every company with every other company.

#### Scenario: The full four-source universe is built

- **WHEN** the merged company count exceeds the old 2,200-company target
- **THEN** each company receives at most six ranked competitors
- **AND** competitor reasons identify the matching evidence used by the score

### Requirement: Operators can search what companies do

The web SHALL provide ranked company search across name, description, category, selected-institution affiliation, cohort/program, and location metadata from the generated artifact.

#### Scenario: Operator searches by problem or category

- **WHEN** an operator searches for descriptive terms such as "AI workflow finance"
- **THEN** the result set includes companies whose indexed metadata covers every meaningful query term
- **AND** stronger company-name and description matches rank above weaker metadata matches

#### Scenario: Operator searches by company name

- **WHEN** an operator enters an exact or prefix company name
- **THEN** that company ranks ahead of incidental description matches

### Requirement: Search exposes snapshot freshness

The web SHALL display the generated artifact timestamp as the search results' last-updated time.

#### Scenario: Operator reviews search results

- **WHEN** a result page is rendered from a manually generated artifact
- **THEN** it shows the artifact's UTC generation date and time
- **AND** it does not imply that the directory refreshes automatically

### Requirement: Discovered companies expose similar-company clusters

Each artifact-backed company detail page SHALL resolve the company's strongest deterministic product-description matches into an explorable similar-company cluster. Category, affiliation, and cohort metadata MAY strengthen a product match but SHALL NOT establish similarity without shared product terms or themes.

#### Scenario: Operator discovers an unfamiliar company

- **WHEN** an operator opens a company such as Screenpipe from search results
- **THEN** the page shows similar companies with descriptions and match reasons
- **AND** every peer links to its own profile so the operator can continue exploring

#### Scenario: Operator follows a similar-company recommendation

- **WHEN** company A displays company B in its similar-company cluster
- **THEN** company B also displays company A in its own similar-company cluster
- **AND** neither company exceeds the configured peer limit

#### Scenario: Companies share only common prose

- **WHEN** two companies in different categories overlap only on generic descriptive words
- **THEN** the similarity graph does not connect them
- **AND** affiliation metadata does not turn that weak overlap into a recommendation

#### Scenario: Operator searches by institution shorthand

- **WHEN** an operator searches with `YC` or `a16z`
- **THEN** the search matches the corresponding canonical Y Combinator or Andreessen Horowitz affiliation

### Requirement: Similarity can use build-time entity facets

The manual company-universe workflow SHALL support a GLiNER enrichment pass that records bounded product capabilities, use cases, target customers, industries, technologies, and products without introducing request-time model inference.

#### Scenario: A manually refreshed artifact is enriched

- **WHEN** the operator runs the entity-enrichment command after the official-source build
- **THEN** each processed company stores de-duplicated entity facets and the artifact stores model, label, threshold, count, completion, and UTC timestamp metadata
- **AND** search and similar-company ranking consume those facets

### Requirement: Reciprocal clusters are materialized offline

The manual refresh workflow SHALL materialize an undirected, degree-bounded similarity graph after entity enrichment, and the web SHALL prefer that graph over request-time directional top-k ranking.

#### Scenario: The reciprocal pass completes

- **WHEN** the enriched artifact is processed
- **THEN** every stored similarity edge appears on both endpoint companies with the same score and reason
- **AND** every company has at most six stored peers

#### Scenario: An older or lookup-created company lacks reciprocal metadata

- **WHEN** a company profile has no materialized reciprocal graph
- **THEN** the web falls back to deterministic request-time similarity or preserved competitor edges
