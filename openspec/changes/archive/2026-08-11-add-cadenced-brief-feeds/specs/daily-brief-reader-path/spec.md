## MODIFIED Requirements

### Requirement: Today's Daily Brief is the public starting point
The root public route SHALL present today's Daily Brief as the product's primary and default feed experience, and the legacy `/brief` route SHALL resolve to that same canonical experience without creating a competing homepage. Other feeds and cadences SHALL be available through a subordinate edition switcher and SHALL NOT replace the default based on account history or inferred personalization.

#### Scenario: New visitor opens High Signal
- **WHEN** a visitor opens the root route
- **THEN** the visitor sees today's Daily Brief before product explanation, directories, or operator tools
- **AND** the page identifies its edition date, freshness, scope, and evidence contract
- **AND** the publication switcher makes the other bounded feeds discoverable without obscuring the edition

#### Scenario: Existing brief link is opened
- **WHEN** a visitor opens `/brief`
- **THEN** the visitor reaches the canonical current Daily Brief without duplicate indexable content

#### Scenario: Returning visitor preferred another feed
- **WHEN** a visitor who previously read a focused feed returns to the root route
- **THEN** the root still presents the current Daily Brief
- **AND** only the layout preference may be restored locally

## ADDED Requirements

### Requirement: Feed, cadence, and layout controls remain distinct
The reading surface SHALL present feed selection, cadence selection, and Brief/Newspaper layout selection as separate controls so a reader can tell whether they are changing content, time window, or presentation.

#### Scenario: Reader inspects the current edition controls
- **WHEN** the edition loads
- **THEN** the active feed and cadence are identified as content choices
- **AND** the active Brief or Newspaper mode is identified as a presentation choice
