# intent-aware-daily-brief Specification

## Purpose
Define how brand intent findings enrich owner-scoped Daily Brief sections while failing independently.

## Requirements

### Requirement: Brand perception includes the strongest open intent finding
For an owner-scoped Daily Brief, the system SHALL attach the highest-scoring open intent opportunity for each connected brand to section 4. The attached finding SHALL retain its source URL, source title and excerpt, platform, buyer stage, action type, score, competitor context, and discovery time.

#### Scenario: Brand has mention metrics and open intent
- **WHEN** an owner requests the Daily Brief and a connected brand has both a completed mention check and open intent opportunities
- **THEN** section 4 includes the existing mention metrics and the brand's highest-scoring open intent finding

#### Scenario: Brand has open intent but no completed mention check
- **WHEN** a connected brand has an open intent opportunity but no completed mention check
- **THEN** section 4 still includes the brand with unavailable metrics and the source-linked intent finding

### Requirement: Product improvements include intent-derived actions
The system SHALL translate actionable open intent opportunities into section 5 items. It SHALL retain the source context, SHALL link back to the Mentions intent inbox, and SHALL avoid duplicating an Agent Eval evidence task backed by the same source URL.

#### Scenario: Intent is already represented by an evidence task
- **WHEN** an open intent opportunity and an open Agent Eval task share a source URL
- **THEN** section 5 includes one source-linked improvement rather than duplicate entries

#### Scenario: Intent has no linked evidence task
- **WHEN** an open intent opportunity recommends a reply, proof, docs, integration, comparison, or content action and no Agent Eval task represents its source
- **THEN** section 5 includes a concise, priority-ranked action linked to the intent inbox and original source

### Requirement: Brief delivery preserves intent evidence
Every rendered Daily Brief surface SHALL expose the source and meaningful intent context for intent-backed section 4 and section 5 items.

#### Scenario: Web brief renders intent context
- **WHEN** a Daily Brief snapshot contains an intent-backed perception or improvement item
- **THEN** the web brief shows its buyer stage, platform, score, recommended action, source title, and source link

#### Scenario: Delivered brief renders intent context
- **WHEN** a Daily Brief snapshot is converted to delivery sections
- **THEN** the delivered section text identifies the intent stage and action and includes the original source URL

### Requirement: Intent enrichment fails independently
The system MUST preserve existing mention, Agent Eval, and watchlist brief output when intent storage is unavailable, including deployments where migration 0014 has not been applied.

#### Scenario: Intent table is unavailable
- **WHEN** the owner-scoped brief cannot query `intent_opportunities`
- **THEN** the brief returns its existing sections without intent enrichment instead of failing or discarding existing personal data

### Requirement: Migration verification remains local
Migration 0014 SHALL be executable against an isolated local D1 database and SHALL create the intent table and its expected indexes without requiring remote state or credentials.

#### Scenario: Isolated local migration verification
- **WHEN** migration 0014 is applied to a fresh local D1 persistence directory
- **THEN** the local schema contains `intent_opportunities` plus its unique brand/source index and brand-score and owner-update indexes
