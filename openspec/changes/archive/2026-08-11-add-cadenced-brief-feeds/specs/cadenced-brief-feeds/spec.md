## Purpose

Defines a small catalog of evidence-qualified High Signal feeds whose daily, weekly, or monthly cadence matches the rate at which their underlying observations become useful.

## ADDED Requirements

### Requirement: The publication exposes a bounded feed catalog
High Signal SHALL expose exactly four initial public feeds with these supported cadences: The Brief (`daily`, `weekly`, `monthly`), Markets & Companies (`daily`, `weekly`, `monthly`), Opportunity Radar (`weekly`, `monthly`), and Behavior & Culture (`weekly`, `monthly`). Each feed SHALL identify one default cadence, and unsupported feed/cadence combinations SHALL resolve to the feed's default without presenting fabricated editions.

#### Scenario: Reader opens the feed switcher
- **WHEN** a reader opens any public edition
- **THEN** the switcher lists the four available feeds with a plain-language cadence label
- **AND** The Brief is identified as the default public feed

#### Scenario: Reader requests an unsupported cadence
- **WHEN** a reader requests a daily Opportunity Radar or daily Behavior & Culture edition
- **THEN** the reader reaches that feed's weekly edition
- **AND** the interface explains that the feed is published weekly because it requires evidence to accumulate

### Requirement: Period editions use accepted daily records
Daily feed editions SHALL use one accepted daily brief snapshot. Weekly and monthly feed editions SHALL be deterministic rollups over accepted daily snapshots in the corresponding UTC calendar period, and SHALL NOT introduce generated claims, synthetic filler, or uncited replacement summaries.

#### Scenario: Weekly edition is composed
- **WHEN** a reader opens a weekly feed edition
- **THEN** its content is drawn only from publishable accepted daily snapshots in that UTC Monday-through-Sunday period
- **AND** every item preserves its original claim, evidence links, and daily edition provenance

#### Scenario: Monthly edition is composed
- **WHEN** a reader opens a monthly feed edition
- **THEN** its content is drawn only from publishable accepted daily snapshots in that UTC calendar month
- **AND** the edition identifies whether the month is complete or still in progress

#### Scenario: No accepted daily record exists
- **WHEN** the requested period contains no accepted snapshot for the selected region
- **THEN** the edition renders an unavailable state
- **AND** no live reconstruction or seed content is substituted for the missing historical record

### Requirement: Rollups are de-duplicated and period-bounded
Period rollups SHALL include only items whose published or surfaced timestamp falls within the requested period and SHALL de-duplicate repeated daily appearances by stable signal identity or normalized evidence identity. The edition SHALL retain the most recent accepted representation of a duplicate item and disclose its contributing daily edition dates.

#### Scenario: Signal appears in several daily snapshots
- **WHEN** the same signal is present in multiple accepted snapshots inside a period
- **THEN** the period feed displays it once
- **AND** its provenance lists each contributing daily edition date

#### Scenario: Old item remains in a recent daily snapshot
- **WHEN** an accepted daily snapshot contains an item whose own published or surfaced date precedes the requested period
- **THEN** the period rollup excludes that item

### Requirement: Feed routes are stable and shareable
Focused feeds SHALL have bounded path-based routes containing feed and cadence, while The Brief daily current edition SHALL remain available at `/` and its immutable daily archive SHALL remain at `/brief/<YYYY-MM-DD>`. Period editions SHALL expose a stable period key, UTC start and end dates, selected region, contributing daily editions, and a canonical URL.

#### Scenario: Reader shares a weekly feed
- **WHEN** a reader copies the URL of a Markets & Companies weekly edition
- **THEN** another reader reaches the same feed, cadence, period, and region
- **AND** presentation preference does not alter the canonical content URL

#### Scenario: Reader follows daily provenance
- **WHEN** a reader follows a contributing-edition link from a weekly or monthly item
- **THEN** the reader reaches the immutable `/brief/<YYYY-MM-DD>` daily record

### Requirement: Category state remains honest at every cadence
Each feed edition SHALL distinguish `ready`, `empty`, and `unavailable` states. A period with accepted source editions but no qualifying items for the selected feed SHALL be empty; a period without usable accepted editions SHALL be unavailable.

#### Scenario: Accepted week contains no opportunities
- **WHEN** accepted daily editions exist for a week but no Opportunity Radar item falls within that week
- **THEN** the weekly feed renders an empty state
- **AND** it does not imply a source outage
