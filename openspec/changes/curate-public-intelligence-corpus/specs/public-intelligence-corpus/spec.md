## Purpose

Defines which evidence-backed High Signal pages qualify for public search discovery and ensures every discovery surface applies the same measurable decision.

## ADDED Requirements

### Requirement: Public pages receive one deterministic indexability verdict
The system SHALL assign every public dynamic page an indexability verdict containing an eligibility state, a content tier, and machine-readable reason codes derived from the page's retained evidence and substantive content.

#### Scenario: The same record is evaluated twice
- **WHEN** the underlying record and policy revision have not changed
- **THEN** both evaluations return the same eligibility state, tier, and reason codes

#### Scenario: A page lacks enough evidence or substantive content
- **WHEN** a public dynamic page fails the minimum policy for its route family
- **THEN** its verdict is ineligible
- **AND** the reasons identify each failed requirement without substituting a generic quality score

### Requirement: Discovery surfaces agree on eligible pages
The HTML metadata, canonical sitemap, agent-readable route inventory, and search-engine submission queue SHALL derive discovery eligibility from the same verdict.

#### Scenario: A page is eligible
- **WHEN** a dynamic page receives an eligible verdict
- **THEN** it can appear in the canonical sitemap, agent-readable inventory, and search-engine submission queue
- **AND** its HTML metadata permits indexing and provides a self-canonical URL

#### Scenario: A page is not yet eligible
- **WHEN** a dynamic page receives an ineligible verdict
- **THEN** the route remains reachable from the product where appropriate
- **AND** its HTML metadata is `noindex,follow`
- **AND** it is absent from the canonical sitemap, agent-readable inventory, and search-engine submission queue

### Requirement: Each indexable page answers a distinct search question
Every eligible page SHALL render a unique title, description, primary heading, evidence-backed explanatory content, provenance, and useful internal links appropriate to its route family.

#### Scenario: A company profile qualifies
- **WHEN** an eligible company profile renders
- **THEN** it explains what the company does, why it is in the universe, its official-source provenance, and its strongest meaningful comparison cluster
- **AND** the title and description describe the company rather than the generic directory

#### Scenario: A signal or archive page qualifies
- **WHEN** an eligible signal, brief, entity, entity-period, or taxonomy page renders
- **THEN** it exposes the dated evidence, the subject or intent represented by the route, and links to supporting and related public pages

### Requirement: Eligibility changes are measurable and fail closed
Every generated corpus refresh SHALL produce a receipt containing the policy revision and eligible, withheld, newly eligible, newly withheld, and per-reason counts for each route family.

#### Scenario: A refresh changes the eligible corpus
- **WHEN** the new corpus is compared with the last accepted receipt
- **THEN** the receipt identifies the added and removed canonical URLs and their reason codes

#### Scenario: A refresh causes an implausible eligibility change
- **WHEN** an expected route family becomes empty or its eligible count changes beyond the configured review boundary
- **THEN** the refresh exits non-zero
- **AND** it does not replace the last accepted discovery corpus

### Requirement: Programmatic pages remain evidence-derived
The system MUST NOT invent company facts, market claims, source citations, or predictions to make a page meet an indexability threshold.

#### Scenario: A record is below threshold
- **WHEN** no additional retained evidence is available for a sparse record
- **THEN** the page remains withheld from search discovery
- **AND** generated filler text is not added to make it eligible

