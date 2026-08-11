## MODIFIED Requirements

### Requirement: Auto-publish uses structured claim evidence
The auto-publish runner SHALL load claims attached to each signal and SHALL judge evidence by its structured role and claim alignment whenever at least one structured claim exists. A publishable claim SHALL include at least one semantically aligned primary source and one semantically aligned corroborating source from an independent host or source class; context SHALL NOT count as support, contradiction SHALL block publication until resolved, and unusable required evidence SHALL fail closed.

#### Scenario: Structured supporting claims are available
- **WHEN** a queued signal has a primary and corroborating evidence link that each support the assertion and satisfy independence rules
- **THEN** deterministic and AI judging use those supporting links rather than the signal's legacy evidence array

#### Scenario: Context is mistaken for corroboration
- **WHEN** a claim has one primary link and additional links classified only as context
- **THEN** the claim does not pass the primary-plus-corroboration publication gate

#### Scenario: Evidence contradicts the claim
- **WHEN** an unresolved contradiction link is attached to the claim
- **THEN** auto-publish blocks the signal and records the contradiction reason

#### Scenario: Required evidence is unusable
- **WHEN** a required supporting link is malformed, known dead, or lacks a retained source receipt sufficient to verify its claim relationship
- **THEN** the claim fails closed instead of receiving evidence credit

#### Scenario: Structured claims are not yet available
- **WHEN** a queued historical signal has no attached claim record
- **THEN** auto-publish uses the legacy signal payload only as an explicitly reported compatibility path
- **AND** that compatibility path cannot make the item eligible for a new Daily Brief snapshot until supporting evidence roles are established

### Requirement: Brief items expose compact provenance
Eligible brief signal items SHALL expose a structured claim reference, editorial summary fields, and evidence-role summary that the UI can reveal without navigating away. A new Daily Brief snapshot SHALL NOT include a legacy signal that lacks qualifying structured support.

#### Scenario: A stock item has a qualifying structured claim
- **WHEN** the Daily Brief composes a stock signal with eligible attached claim evidence
- **THEN** the item includes the claim identifier, assertion, version, supporting evidence count, role counts, what changed, why it matters, and principal uncertainty

#### Scenario: A cached historical item has no provenance
- **WHEN** the UI renders a brief snapshot created before structured provenance was required
- **THEN** the historical item renders without a runtime error and is visibly treated as a legacy archived record
