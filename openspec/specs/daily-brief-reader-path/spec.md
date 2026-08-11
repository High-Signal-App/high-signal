# daily-brief-reader-path Specification

## Purpose
Defines a single, comprehensible public reading path from today's broad Daily Brief into individual signals, supporting evidence, measured outcomes, and permanent history.

## Requirements

### Requirement: Today's Daily Brief is the public starting point
The root public route SHALL present today's Daily Brief as the product's primary experience, and the legacy `/brief` route SHALL resolve to that same canonical experience without creating a competing homepage.

#### Scenario: New visitor opens High Signal
- **WHEN** a visitor opens the root route
- **THEN** the visitor sees today's Daily Brief before product explanation, directories, or operator tools
- **AND** the page identifies its edition date, freshness, scope, and evidence contract

#### Scenario: Existing brief link is opened
- **WHEN** a visitor opens `/brief`
- **THEN** the visitor reaches the canonical current Daily Brief without duplicate indexable content

### Requirement: Primary navigation reflects the reading sequence
Public primary navigation SHALL lead with Brief, Signals, Track record, and Sources, while secondary tools and lenses remain discoverable through Explore and contextual links.

#### Scenario: Visitor wants today's synthesis
- **WHEN** a visitor uses the first primary navigation item
- **THEN** the visitor reaches the current Daily Brief

#### Scenario: Visitor wants to verify a brief item
- **WHEN** a visitor follows a signal, evidence, or outcome link from the brief
- **THEN** the destination preserves a clear route back to the current edition or its dated archive

### Requirement: The edition exposes a category-level table of contents
The Daily Brief SHALL expose its public categories near the beginning of the edition with plain-language labels, current item counts, and links to stable in-page section anchors.

#### Scenario: Broad edition contains all categories
- **WHEN** market and company signals, business opportunities, and behavior and culture items are present
- **THEN** the contents row exposes all three categories with counts
- **AND** selecting a category moves focus to its section without hiding the other categories

#### Scenario: A category is empty
- **WHEN** a category has no qualifying real items
- **THEN** its contents entry identifies the empty state rather than implying unavailable items exist

### Requirement: Supporting surfaces remain subordinate to the edition
Convergence, methodology, filters, sharing, archive navigation, and reader controls SHALL support the Daily Brief without interrupting the path from edition heading to category contents to editorial items.

#### Scenario: Visitor reads the first viewport
- **WHEN** the current brief loads successfully
- **THEN** the visitor encounters the edition identity and category choices before convergence diagnostics, product configuration, or system architecture links
