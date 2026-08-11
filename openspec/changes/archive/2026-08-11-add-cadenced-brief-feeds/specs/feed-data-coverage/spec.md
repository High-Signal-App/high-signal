## Purpose

Defines how High Signal verifies public-data capability parity against the popular reference products used in product decisions without claiming access to premium, proprietary, or restricted datasets it does not possess.

## ADDED Requirements

### Requirement: Public-data parity is mapped to attributable references
High Signal SHALL maintain a machine-readable parity baseline for The Daily Diff, Octolens, Peekaboo, Subreddit Signals, AlphaSense, Quartr, and RavenPack. Each benchmark capability SHALL include an official reference URL, a concise data-class description, mapped High Signal source IDs or product capabilities, and a status of `covered`, `partial`, or `unavailable`.

#### Scenario: Operator inspects a covered capability
- **WHEN** a benchmark capability is marked `covered`
- **THEN** at least one mapped High Signal source or implemented product capability exists
- **AND** the baseline links to an official page supporting the benchmark description

#### Scenario: Reference depends on premium data
- **WHEN** a reference capability requires broker research, expert calls, licensed private-company data, or real-time global earnings transcripts
- **THEN** the baseline marks that capability `partial` or `unavailable`
- **AND** High Signal does not represent adjacent public filings or news as equivalent data

### Requirement: Covered source capabilities are regression tested
Automated checks SHALL compare every source-backed capability marked `covered` with the generated High Signal source catalog and SHALL fail when none of its mapped source IDs remain present. Product-capability mappings SHALL be covered by their owning feature tests rather than silently treated as source adapters.

#### Scenario: A mapped source is removed
- **WHEN** the last source ID supporting a covered source-backed capability disappears from the generated catalog
- **THEN** the parity check fails
- **AND** the capability must be remapped, downgraded, or restored deliberately

#### Scenario: One of several mapped sources is removed
- **WHEN** another mapped live source still supports the same capability
- **THEN** the parity check remains green
- **AND** the generated parity summary reflects the surviving mapping

### Requirement: Every feed edition exposes a coverage receipt
Feed editions SHALL expose a coverage receipt containing the High Signal source classes configured for that feed, source classes actually contributing evidence to the edition, the number of unique evidence domains, and known material gaps relevant to that feed. Coverage SHALL be derived from retained evidence and the parity baseline rather than inferred from item count.

#### Scenario: Markets edition uses filings and news
- **WHEN** a Markets & Companies edition contains official filing and independent-news evidence
- **THEN** its receipt identifies both official and news as contributing classes
- **AND** it reports the unique evidence-domain count

#### Scenario: Configured class contributes no item
- **WHEN** a feed supports community evidence but no community source survives the selected period's editorial gate
- **THEN** community remains listed as configured but not contributing
- **AND** the UI does not imply that the class was represented in that edition

### Requirement: Parity claims remain scoped and visible
The reader-facing coverage disclosure SHALL describe High Signal's baseline as public-data capability coverage, not source-volume, latency, language, or licensed-content parity. Material gaps SHALL remain visible from the edition receipt or its linked methodology page.

#### Scenario: Reader opens the coverage details
- **WHEN** a reader follows the edition coverage disclosure
- **THEN** the reader can distinguish public-source coverage from premium or restricted gaps
- **AND** the disclosure names the last verification date and reference sources
