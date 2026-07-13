## ADDED Requirements

### Requirement: Signed-in briefs include owner-scoped watching items
The Daily Brief SHALL include a `watching.items` block composed from the owner's default watchlist, published direct and one-hop signals, relationship verification, confidence, and suppression rules.

#### Scenario: Owner has eligible watched signals
- **WHEN** `/brief/daily` receives an owner with watched entities and fresh published signals
- **THEN** the response includes up to five priority-ranked watch items with direct or second-order labels and confidence context

#### Scenario: Owner has no watch data
- **WHEN** the owner has no default watchlist, watched entity, eligible signal, or graph edge
- **THEN** the response includes an empty watching block and all public brief sections still render

#### Scenario: Watchlist data cannot be read
- **WHEN** the watching builder encounters a missing table or transient database error
- **THEN** the error is contained to the watching block and the rest of the brief response succeeds

### Requirement: Watch items are claim-linked and evidence-backed
Every surfaced watch item SHALL reference a structured claim with at least one evidence URL and SHALL include a plain-language relationship explanation.

#### Scenario: Impact item has an evidence-backed claim
- **WHEN** a composed direct or second-order signal has a claim containing evidence links
- **THEN** the watch item includes claim provenance, signal/entity links, confidence, observed or inferred state, and the relationship explanation

#### Scenario: Impact item lacks claim evidence
- **WHEN** a composed signal has no structured claim or its claims have no evidence links
- **THEN** that signal is omitted from the watching block

### Requirement: Brief renders a compact Watching section
The signed-in Daily Brief UI SHALL render watch items between the public and personal sections and SHALL make provenance and relationship context accessible through a compact disclosure.

#### Scenario: Watching items exist
- **WHEN** the brief snapshot contains one or more watching items
- **THEN** the UI shows a Watching section with subject name, signal headline, confidence, direct or second-order state, and a “why this is here” disclosure linking to the claim and evidence

#### Scenario: Watching items are absent
- **WHEN** the brief snapshot contains no watching items or predates the watching field
- **THEN** the UI omits the section without showing an empty error state
