## Purpose

Defines interchangeable Brief and Newspaper reading layouts that preserve one edition's content, provenance, accessibility, and shared-cache behavior.

## ADDED Requirements

### Requirement: Reading mode changes layout only
The reading surface SHALL provide `Brief` and `Newspaper` modes. Switching mode SHALL change visual hierarchy and responsive arrangement only; it SHALL NOT change item selection, ordering semantics, editorial copy, evidence, feed, cadence, region, period, metadata, or canonical URL.

#### Scenario: Reader changes to Newspaper mode
- **WHEN** a reader selects Newspaper mode on an edition
- **THEN** the same edition items and evidence links render in a denser editorial arrangement
- **AND** no new API request for personalized content is required

#### Scenario: Reader returns to Brief mode
- **WHEN** a reader selects Brief mode
- **THEN** the edition returns to the focused linear reading layout without losing scrollable content or provenance

### Requirement: Layout preference is local and cache-safe
The selected layout SHALL be remembered on the reader's device using non-server preference storage. Anonymous server responses and edge-cache keys SHALL remain independent of reading layout, and the default without a stored preference or JavaScript SHALL be Brief mode.

#### Scenario: Returning reader opens another feed
- **WHEN** a reader previously selected Newspaper mode and opens a different edition on the same device
- **THEN** Newspaper mode is applied locally
- **AND** the public response remains the same response served to readers using Brief mode

#### Scenario: Storage is unavailable
- **WHEN** browser storage cannot be read or written
- **THEN** the control continues to work for the current page when possible
- **AND** Brief remains the safe default on the next navigation

### Requirement: Both layouts remain accessible and responsive
The mode control SHALL be keyboard operable, expose its selected state programmatically, and preserve logical document order. At narrow widths, both layouts SHALL collapse to a readable single-column flow without horizontal page overflow.

#### Scenario: Keyboard reader changes layout
- **WHEN** focus reaches the mode control and the reader activates a mode
- **THEN** the selected state is announced
- **AND** focus remains in a predictable location

#### Scenario: Newspaper mode is opened on mobile
- **WHEN** the viewport is 390 pixels wide
- **THEN** all headlines, evidence, and controls remain readable in one column
- **AND** the page does not require horizontal scrolling
