## ADDED Requirements

### Requirement: Failed delivery can be retried by its owner
The system SHALL let a signed-in user manually retry a failed email delivery row that belongs to that user, SHALL increment the row's attempt count, and SHALL update the same row with the resulting sent or failed status.

#### Scenario: Owner retries a failed delivery
- **WHEN** a signed-in user requests retry for their own failed email delivery and the saved email preference and transport are available
- **THEN** the system claims the row, composes the current canonical brief for the saved region and brand, attempts one send, increments `attempt`, and stores the result on the original row

#### Scenario: User targets an ineligible row
- **WHEN** a user targets another user's row, a non-email row, or a row whose status is not failed
- **THEN** the system SHALL refuse the retry without sending email or changing a successful delivery

#### Scenario: Concurrent retry loses the claim
- **WHEN** two retry requests target the same failed row concurrently
- **THEN** only the request that conditionally changes the row from failed to queued SHALL continue to the provider call

### Requirement: Delivery settings expose retry state
The delivery settings page SHALL render a retry action for failed rows and SHALL refresh the visible log and failure banner after a retry result.

#### Scenario: Retry from failed row
- **WHEN** the user activates retry on a failed delivery row
- **THEN** the page SHALL disable duplicate interaction for that row, call the authenticated retry route, surface an explicit failure if the route refuses or fails, and reload the delivery log on completion

### Requirement: Private feeds use stable opaque tokens
The system SHALL issue a high-entropy opaque token for an RSS delivery preference, preserve that token across ordinary preference edits, and require an enabled matching preference before returning a private feed.

#### Scenario: User enables private feeds
- **WHEN** a signed-in user enables the RSS channel without an existing token
- **THEN** the system SHALL persist a new opaque token and return same-origin RSS and Atom feed URLs containing that token

#### Scenario: User edits an existing RSS preference
- **WHEN** a signed-in user updates region or other RSS preference fields
- **THEN** the system SHALL preserve the existing feed token

#### Scenario: Invalid or disabled token requests a feed
- **WHEN** `/digest/rss` or `/digest/atom` receives an unknown token or one belonging to a disabled RSS preference
- **THEN** the system SHALL return an authorization error without revealing a user id or brief content

### Requirement: Private RSS and Atom transport the daily brief
Token-authenticated RSS and Atom responses SHALL represent the same ordered daily brief sections composed for the token owner's saved region and connected brand, and SHALL include available evidence links.

#### Scenario: Valid private feed request
- **WHEN** an enabled RSS preference's token requests RSS or Atom
- **THEN** the system SHALL compose the current daily brief using that preference, return valid feed XML with the five-section order preserved for non-empty sections, and mark the response private and non-cacheable

#### Scenario: Public feed request has no token
- **WHEN** the existing RSS or Atom route is requested without a token
- **THEN** the existing public weekly digest behavior SHALL remain available

### Requirement: Compact daily brief JSON is versioned and authenticated
The system SHALL expose an authenticated compact JSON representation of the current user's daily brief with a stable schema identifier, ordered non-empty sections, concise item text, and available evidence URLs.

#### Scenario: Signed-in user requests compact digest
- **WHEN** a signed-in user requests `GET /delivery/digest`
- **THEN** the system SHALL use that user's saved delivery preference to compose the daily brief and return `high-signal.compact-digest.v1` without creating or mutating a delivery log row

#### Scenario: Compact digest cannot be composed
- **WHEN** the user is unauthenticated, the preference is unavailable, or canonical brief composition fails
- **THEN** the system SHALL fail explicitly rather than returning another user's data or a fabricated successful payload
