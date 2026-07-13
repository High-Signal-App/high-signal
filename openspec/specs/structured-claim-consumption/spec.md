# structured-claim-consumption Specification

## Purpose
Define how structured claim evidence is consumed by publishing, backfill, and brief surfaces.

## Requirements

### Requirement: Auto-publish uses structured claim evidence
The auto-publish runner SHALL load claims attached to each signal and SHALL use distinct `claim_evidence_links` URLs and their independent hosts for judging whenever at least one structured claim exists.

#### Scenario: Structured claims are available
- **WHEN** a queued signal has one or more attached claim records with evidence links
- **THEN** deterministic and AI judging use the structured evidence URLs rather than the signal's legacy evidence array

#### Scenario: Structured claims are not yet available
- **WHEN** a queued historical signal has no attached claim record
- **THEN** auto-publish uses the legacy signal payload as an explicit compatibility fallback and reports that provenance source

### Requirement: Historical claims backfill lazily and idempotently
The system SHALL provide an authenticated operator action that creates a single signal claim and role-tagged evidence links from a historical signal when no claim exists, and SHALL return the existing claim without duplicating rows on retries.

#### Scenario: Operator opens provenance for an unbackfilled signal
- **WHEN** `/review` opens the provenance disclosure for a signal with legacy evidence but no claim record
- **THEN** the system creates one claim, assigns the first distinct URL `primary` and later distinct URLs `corroboration`, records timeline events, and returns the new claim

#### Scenario: Backfill is retried
- **WHEN** the backfill action runs for a signal that already has a claim
- **THEN** no additional claim or evidence rows are created and the existing claim identifier is returned

### Requirement: Brief items expose compact provenance
Eligible brief signal items SHALL expose an optional structured claim reference and evidence-role summary that the UI can reveal without navigating away.

#### Scenario: A stock item has a structured claim
- **WHEN** the Daily Brief composes a stock signal with an attached claim and evidence
- **THEN** the item includes the claim identifier, assertion, version, evidence count, and role counts

#### Scenario: A cached legacy item has no provenance
- **WHEN** the UI renders a brief snapshot created before structured provenance was added
- **THEN** the item renders normally without a provenance disclosure or runtime error
