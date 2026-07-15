## MODIFIED Requirements

### Requirement: Operators can search what companies do

The web SHALL provide ranked company search across name, description, category, selected-institution affiliation, cohort/program, and location metadata from the generated artifact. Search results SHALL be paginated in stable match order with exactly 20 companies per page except for the final partial page, and the browser SHALL receive only the rendered page rather than the full company universe.

#### Scenario: Operator searches by problem or category

- **WHEN** an operator searches for descriptive terms such as "AI workflow finance"
- **THEN** the result set includes companies whose indexed metadata covers every meaningful query term
- **AND** stronger company-name and description matches rank above weaker metadata matches

#### Scenario: Operator searches by company name

- **WHEN** an operator enters an exact or prefix company name
- **THEN** that company ranks ahead of incidental description matches

#### Scenario: A query has more than 20 matches

- **WHEN** an operator opens any result page for that query
- **THEN** the page shows at most 20 companies from the globally ranked match set
- **AND** pagination preserves the query and stable match position across pages

#### Scenario: Search navigation is pending

- **WHEN** an operator submits a search or selects another result page
- **THEN** the initiating control immediately exposes a visible and screen-reader-readable loading state
- **AND** the pending state remains until the server-rendered navigation completes
