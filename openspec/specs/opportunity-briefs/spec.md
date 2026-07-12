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

### Requirement: India D2C niches produce cited Opportunity Briefs
The system SHALL produce an Opportunity Brief for each of 20 curated India D2C niches, reusing the existing `OpportunityBriefPayload` contract, with verdict, confidence, target user, problem, evidence mix, competitor/pricing/agent-visibility notes, risks, and next validation step.

#### Scenario: Seed briefs render without a weekly artifact
- **WHEN** no `data/d2c-opportunities/<date>.json` artifact exists
- **THEN** the system emits Opportunity Briefs from the static niche seed with conservative placeholder evidence and a `watch` or `test` verdict

#### Scenario: Weekly artifact enriches seed briefs
- **WHEN** a weekly collector artifact exists for a niche
- **THEN** the brief for that niche replaces placeholder evidence with cited community/search evidence and recomputes the verdict and confidence from the artifact's scores

#### Scenario: Verdict mapping is deterministic
- **WHEN** a niche has demand ≥ 0.5, competition gap ≥ 0.4, and a first SKU
- **THEN** the verdict is `test`
- **WHEN** a niche has demand < 0.3 or competition gap < 0.2
- **THEN** the verdict is `avoid`
- **WHEN** a niche has demand ≥ 0.3 but missing corroboration
- **THEN** the verdict is `watch`

### Requirement: India D2C briefs surface in the Daily Brief and opportunities page
The system SHALL render India D2C Opportunity Briefs in `/opportunities` and inline in Daily Brief section 02 when the region includes India.

#### Scenario: South-Asia brief includes India D2C ideas
- **WHEN** `/brief/daily?region=south-asia` is composed
- **THEN** section 02 includes up to 3 India D2C Opportunity Briefs ahead of community-digest ideas

#### Scenario: Opportunities page has an India D2C section
- **WHEN** `/opportunities` is rendered
- **THEN** the page includes an "India D2C Opportunity Briefs" section listing the curated niches with verdict, confidence, evidence mix, and next validation step

#### Scenario: No impuls8 dependency
- **WHEN** the India D2C pipeline runs end to end
- **THEN** no request is made to impuls8 endpoints and no impuls8 data is read or redistributed

### Requirement: Weekly collector writes cited JSON artifacts
The system SHALL provide a weekly collector that pulls narrow public community samples for the 20 niches and writes a dated, cited JSON artifact under `data/d2c-opportunities/`.

#### Scenario: Collector writes one artifact per run
- **WHEN** the collector runs for a given date
- **THEN** it writes `data/d2c-opportunities/<YYYY-MM-DD>.json` containing one entry per niche with evidence URLs and extracted snippets

#### Scenario: Fragile sources degrade to null with a freshness date
- **WHEN** a source (Google Trends, Meta Ad Library, marketplace pages) is unavailable or fragile
- **THEN** the collector records the corresponding score field as `null` and includes a `freshnessDate` so the renderer can label staleness

#### Scenario: Collector is fail-closed without paid sources
- **WHEN** the collector runs
- **THEN** it uses only free public sources (Reddit, HN, Product Hunt RSS) and never requires a paid data provider

