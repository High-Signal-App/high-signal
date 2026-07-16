## MODIFIED Requirements

### Requirement: Unknown companies are persisted

The system SHALL create an on-demand company row when a valid operator lookup or bounded public Evidence Report lookup does not match an existing company.

#### Scenario: Operator enters a new company

- **WHEN** an authenticated operator lookup contains a valid new company name
- **THEN** the system inserts a company row with `pending_enrichment` status
- **AND** the response includes the created company slug
- **AND** source evidence records that the row came from operator submission

#### Scenario: Public report visitor enters a new company

- **WHEN** a valid public Evidence Report lookup does not match an existing company and passes abuse controls
- **THEN** the system inserts one company row with `pending_enrichment` status
- **AND** source evidence records that the row came from a public report request without storing the visitor's raw network identity as company evidence

#### Scenario: Public request is not eligible

- **WHEN** a public Evidence Report lookup fails validation or abuse controls
- **THEN** the system does not create a company row
