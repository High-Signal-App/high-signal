# company-lookup-create Specification

## Purpose
TBD - created by archiving change add-company-lookup-create. Update Purpose after archive.
## Requirements
### Requirement: Existing companies resolve without duplication

The system SHALL return an existing D1 company when a lookup matches its slug,
normalized name, or domain.

#### Scenario: User enters an existing generated company

- **WHEN** the lookup request matches an existing company
- **THEN** the system returns the existing company and competitors
- **AND** it does not insert a duplicate company row

### Requirement: Unknown companies are persisted

The system SHALL create an on-demand company row when a lookup does not match
an existing company.

#### Scenario: User enters a new company

- **WHEN** the lookup request contains a valid new company name
- **THEN** the system inserts a company row with `pending_enrichment` status
- **AND** the response includes the created company slug
- **AND** source evidence records that the row came from operator submission

### Requirement: Created companies receive competitors

The system SHALL map first-pass competitors for newly-created companies from
the existing D1 company universe.

#### Scenario: Competitors are generated for a new company

- **WHEN** a new company is created
- **THEN** the system inserts competitor edges for the company when peers exist
- **AND** each edge includes a score and human-readable reason

### Requirement: Freshness is visible

The system SHALL expose generated/requested/enriched timestamps so clients can
show when a company profile was last updated.

#### Scenario: Client renders a lookup result

- **WHEN** the API returns a company profile
- **THEN** the payload includes `generatedAt`, `updatedAt`, `requestedAt`,
  `lastEnrichedAt`, and `status` where available

