## Purpose

Defines the editorial and evidence threshold for composing a broad Daily Brief that can grow with real coverage without using filler, synthetic claims, or opaque metadata as a substitute for reader value.

## ADDED Requirements

### Requirement: Public briefs contain only real qualifying content
The public current brief and newly created dated snapshots SHALL contain only items derived from retained source evidence and SHALL NOT substitute synthetic stock, idea, trend, product, or personalization records when a category is empty or unavailable.

#### Scenario: Category query returns no qualifying rows
- **WHEN** a public category has no qualifying real items
- **THEN** the brief renders an explicit empty state for that category
- **AND** no seed, rotating demo, or plausible placeholder item is returned as editorial content

#### Scenario: A category builder fails
- **WHEN** a source query, table, or builder is unavailable
- **THEN** the brief identifies that category as unavailable or empty without presenting fallback claims as real observations

### Requirement: Issue size follows quality rather than a target count
Daily Brief composition SHALL include every qualifying item up to a documented operational safety bound and SHALL NOT weaken the publication threshold to reach a minimum item count.

#### Scenario: Coverage is unusually strong
- **WHEN** more items than a typical edition independently satisfy the editorial and evidence gates
- **THEN** the edition can include the additional items within the operational bound

#### Scenario: Coverage is weak
- **WHEN** fewer items satisfy the gate
- **THEN** the edition remains shorter and identifies empty categories honestly

### Requirement: Every brief item explains reader value inline
Every market or company signal in the brief SHALL expose a complete concise statement of what changed, why it matters, and the principal uncertainty or invalidation condition. Idea and behavior items SHALL retain their source-backed description and expose why the item is useful now.

#### Scenario: Market signal renders in the brief
- **WHEN** an eligible market or company signal is included
- **THEN** the card renders complete, non-truncated editorial fields for the change, implication, and uncertainty
- **AND** the full signal remains available for detailed evidence, spillovers, and methodology

#### Scenario: Editorial field cannot be derived safely
- **WHEN** a required inline field would require inventing information not present in retained evidence
- **THEN** the item is withheld from the edition rather than filled with generic prose

### Requirement: Dated editions pass an edition-level quality gate
A current brief snapshot SHALL enter the permanent dated archive only after every included public item passes evidence eligibility, link and sentence integrity checks, category labeling, and the real-content requirement.

#### Scenario: Edition is eligible for archival
- **WHEN** at least one public category contains qualifying real content and every included item passes the edition gate
- **THEN** the snapshot is stored as the permanent dated edition

#### Scenario: Edition contains synthetic or malformed content
- **WHEN** an item contains a seed marker, malformed editorial text, an unusable required evidence link, or an unsupported category assignment
- **THEN** snapshot creation fails closed
- **AND** the last accepted archive remains unchanged

#### Scenario: One category is legitimately empty
- **WHEN** the remaining edition is valid but one category has no qualifying items
- **THEN** the edition can be archived with that explicit empty state
