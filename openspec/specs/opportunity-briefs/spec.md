# opportunity-briefs Specification

## Purpose
TBD - created by archiving change add-opportunity-briefs. Update Purpose after archive.
## Requirements
### Requirement: Daily Brief ideas include decision-grade opportunity context
The system SHALL allow each business-idea item in the Daily Brief to include an Opportunity Brief payload with verdict, confidence, target user, problem, market-timing reasons, evidence mix, competitor notes, pricing notes, agent-visibility notes, risks, next validation step, and prior hit-rate context.

#### Scenario: API returns enriched opportunity fields
- **WHEN** `/brief/daily` returns an idea with an Opportunity Brief payload
- **THEN** the payload includes a verdict, confidence, target user, problem, at least one market-timing reason, at least one evidence mix item, at least one risk, and a next validation step

#### Scenario: Legacy idea items remain valid
- **WHEN** an idea item does not include an Opportunity Brief payload
- **THEN** the brief renderer still shows the title, description, source, subreddit, date, and evidence links without failing

### Requirement: Empty data environments demonstrate Opportunity Briefs
The system SHALL populate fallback business ideas with Opportunity Brief payloads so anonymous and empty-D1 brief views demonstrate the full decision workflow.

#### Scenario: Fallback ideas expose full decision context
- **WHEN** `fallbackIdeas()` is used for a supported region
- **THEN** returned ideas include Opportunity Brief payloads with verdict, confidence, evidence mix, and validation-step fields

### Requirement: Real community ideas degrade conservatively
The system SHALL enrich real community-derived ideas with conservative Opportunity Brief defaults when detailed source-specific extraction is not available.

#### Scenario: Digest-derived idea lacks extracted decision fields
- **WHEN** a community digest provides only a key action title, description, and link
- **THEN** the system emits an Opportunity Brief payload marked for testing or watching with community demand evidence and a validation-oriented next step

### Requirement: Brief UI renders opportunity context compactly
The system SHALL render Opportunity Brief payloads inside the existing section 02 idea card without creating nested cards or requiring a separate page visit.

#### Scenario: Enriched card renders decision fields
- **WHEN** a Daily Brief idea has an Opportunity Brief payload
- **THEN** the card displays the verdict, confidence, target user, problem, evidence mix, market timing, risks, and next validation step in a compact layout

