## ADDED Requirements

### Requirement: The web artifact preserves compact official provenance
The generated web artifact SHALL retain, for every company, the official source identifier, official source URL, institution, title, and available cohort or program needed to substantiate the public profile without shipping duplicate long-form source descriptions.

#### Scenario: A company is copied into the web artifact
- **WHEN** the full company-universe artifact contains one or more official source-evidence records
- **THEN** the web artifact retains a compact provenance record for each source
- **AND** its recorded evidence count equals the number of retained compact provenance records

### Requirement: Company profiles qualify before entering search discovery
The company-universe discovery policy SHALL require an official provenance record, a substantive company description, meaningful extracted product facets, and a non-trivial similarity cluster before a profile becomes indexable.

#### Scenario: A substantively enriched company qualifies
- **WHEN** the company has official provenance, at least 160 description characters, at least two extracted product facets, and at least one similarity edge supported by product or concept overlap
- **THEN** the profile is eligible for search discovery

#### Scenario: An empty directory shell does not qualify
- **WHEN** a company is known only from its institution name, has no substantive description or extracted product facets, or has peers based only on affiliation and directory proximity
- **THEN** the profile remains reachable but is withheld from search discovery

### Requirement: Directory pagination does not compete with company profiles
Numbered company-directory pagination pages SHALL support human navigation and link discovery without being promoted as independent search landing pages.

#### Scenario: A crawler opens a numbered directory page
- **WHEN** the page is not the canonical company-universe landing page
- **THEN** it emits `noindex,follow`
- **AND** it is absent from the canonical sitemap
- **AND** its company links remain crawlable

