## ADDED Requirements

### Requirement: Public report intake
The system SHALL accept a company name or domain from a signed-out visitor, normalize it, and resolve it to one canonical company before a report is requested.

#### Scenario: Existing company is submitted
- **WHEN** a visitor submits a name or domain that matches the company universe
- **THEN** the system associates the request with the existing canonical company
- **AND** it does not create a duplicate company

#### Scenario: Input is invalid
- **WHEN** a visitor submits an empty, malformed, or unsupported value
- **THEN** the system rejects the request without scheduling report work
- **AND** returns a safe, actionable validation message

### Requirement: Evidence-backed report composition
The system SHALL compose a report from captured AI answers, competitor mentions, citation records, and evidence tasks, and every substantive report claim MUST retain provenance to its source record.

#### Scenario: Complete evidence is available
- **WHEN** a report snapshot has captured answers and their source evidence
- **THEN** the report shows how AI describes the company, recommended competitors, cited sources, and evidence gaps
- **AND** each displayed claim links to the supporting captured answer or cited URL

#### Scenario: A section lacks evidence
- **WHEN** the system has no qualifying evidence for a report section
- **THEN** the section is labeled unavailable or insufficient-evidence
- **AND** the system does not synthesize a factual conclusion for that section

### Requirement: Stable report snapshots
The system SHALL persist an immutable report snapshot with a stable public identifier, generation time, input identity, evidence references, and report schema version.

#### Scenario: Visitor opens a shared report
- **WHEN** a valid public report identifier is requested
- **THEN** the system renders the same stored snapshot regardless of later source changes
- **AND** shows when the snapshot was generated

#### Scenario: A newer report exists
- **WHEN** a company has a newer snapshot than the shared snapshot
- **THEN** the shared URL continues to identify the original snapshot
- **AND** the UI can offer an explicit link to the newer report

### Requirement: Bounded anonymous execution
The system MUST rate-limit anonymous report requests, reuse sufficiently fresh compatible snapshots, and cap concurrent or daily provider work before scheduling a new run.

#### Scenario: Fresh compatible snapshot exists
- **WHEN** a visitor requests a report for a company with a fresh compatible snapshot
- **THEN** the system returns the cached snapshot without starting new provider work

#### Scenario: Anonymous budget is exhausted
- **WHEN** a request exceeds the configured identity, company, concurrency, or daily budget
- **THEN** the system does not schedule provider work
- **AND** returns a retryable rate-limit state without exposing internal limits or credentials

### Requirement: Explicit report lifecycle
The system SHALL expose `queued`, `running`, `ready`, `partial`, and `failed` lifecycle states without presenting an incomplete report as complete.

#### Scenario: Some provider work fails
- **WHEN** at least one required report slice succeeds and another fails
- **THEN** the snapshot is marked partial
- **AND** successful evidence remains visible with failed coverage identified

#### Scenario: No qualifying evidence is produced
- **WHEN** a report run produces no qualifying evidence
- **THEN** the request is marked failed
- **AND** no public ready snapshot is created

### Requirement: Dogfood quality gate
The system SHALL keep broad public promotion disabled until reviewed internal reports meet a documented quality gate covering attribution, citation traceability, competitor accuracy, missing-evidence honesty, and output usefulness.

#### Scenario: Internal report fails review
- **WHEN** a dogfood report contains a material unsupported or misattributed claim
- **THEN** the report is excluded from approved examples
- **AND** the failure is recorded against the quality checklist before another review

#### Scenario: Promotion gate is met
- **WHEN** the required reviewed reports pass every mandatory checklist item
- **THEN** the operator can mark the report surface ready for broad public promotion

### Requirement: Product routing without a paywall
The report SHALL provide a next step into the existing brand connection and monitoring workflow without gating report evidence behind billing or a paid tier.

#### Scenario: Visitor wants ongoing monitoring
- **WHEN** a visitor follows the report call to action
- **THEN** the system routes them to connect or monitor the company in High Signal
- **AND** does not require a purchase to read the generated report
