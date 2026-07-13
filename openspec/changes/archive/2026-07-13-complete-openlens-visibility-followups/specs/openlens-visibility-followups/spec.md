## ADDED Requirements

### Requirement: Mentions uses topic and prompt product language
The Mentions configuration surface SHALL call buyer-intent contexts topics, concrete AI inputs prompts, and completed work prompts rather than queries, without renaming persistence fields.

#### Scenario: Operator configures a prompt
- **WHEN** an operator opens the existing Mentions prompt form and check history
- **THEN** the form presents a Topic field alongside the Prompt field and progress is described in prompts

### Requirement: Completed mention checks refresh cited sources
The system SHALL rebuild the brand's cited-source index after a mention check finishes and SHALL run that refresh independently from other post-check derived-data refreshes.

#### Scenario: Mention check finishes
- **WHEN** a mention check finishes with stored result rows
- **THEN** the worker invokes the same bounded cited-source rebuild used by the manual refresh endpoint

#### Scenario: One post-check refresh fails
- **WHEN** either cited-source refresh or intent-opportunity refresh rejects
- **THEN** the other refresh still runs and the failure is logged without changing the already-finished check response

### Requirement: Visibility reports support owner or brand-scoped token access
The report endpoint SHALL return a brand report only when the caller proves ownership or supplies a valid HMAC token scoped to that brand identifier.

#### Scenario: Owner reads a report
- **WHEN** the owner identifier belongs to the requested brand
- **THEN** the report is returned without requiring a share token

#### Scenario: Token holder reads a report
- **WHEN** an unauthenticated caller supplies the valid token derived for the requested brand
- **THEN** the report is returned without an owner identifier

#### Scenario: Token is missing or belongs to another brand
- **WHEN** an unauthenticated caller omits the token or supplies a token derived for a different brand
- **THEN** the endpoint rejects the request before loading report data

#### Scenario: Signing secret is unavailable
- **WHEN** the worker has no server-side signing secret
- **THEN** token generation and unauthenticated token access fail closed while valid owner access remains available

### Requirement: Owners can create a report share token
The system SHALL provide an owner-gated operation that returns the deterministic share token for one owned brand.

#### Scenario: Owner requests a token
- **WHEN** an authenticated owner requests a share token for their brand and the signing secret exists
- **THEN** the system returns a token that validates only for that brand

#### Scenario: Non-owner requests a token
- **WHEN** a caller requests a share token without proving ownership of the brand
- **THEN** the system does not return a token
