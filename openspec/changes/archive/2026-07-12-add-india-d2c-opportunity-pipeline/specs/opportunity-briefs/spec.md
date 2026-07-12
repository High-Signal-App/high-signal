## ADDED Requirements

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
