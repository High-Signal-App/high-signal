## MODIFIED Requirements

### Requirement: Empty data environments demonstrate Opportunity Briefs
The public Daily Brief SHALL render an explicit empty or unavailable state when no cited real opportunity qualifies. Synthetic Opportunity Briefs MAY remain available in explicitly labeled development fixtures or test-only demonstrations but SHALL NOT appear in the public current brief or new dated snapshots.

#### Scenario: Public opportunity category is empty
- **WHEN** no real cited opportunity qualifies for the requested region
- **THEN** the Daily Brief renders an explicit empty state
- **AND** `fallbackIdeas()` output is not returned as public editorial content

#### Scenario: Development fixture is requested explicitly
- **WHEN** a test or explicitly labeled development surface requests an Opportunity Brief fixture
- **THEN** the fixture can demonstrate the payload without being represented as current sourced intelligence

### Requirement: India D2C niches produce cited Opportunity Briefs
The system SHALL produce an Opportunity Brief for a curated India D2C niche only when retained evidence supports its displayed demand, competition, pricing, or momentum statements. Seed metadata MAY define the tracked niche and evaluation template but SHALL NOT create a public verdict or evidence claim without a qualifying collected artifact.

#### Scenario: No weekly artifact exists
- **WHEN** no qualifying `data/d2c-opportunities/<date>.json` artifact exists for a niche
- **THEN** the niche does not appear as a current Daily Brief opportunity
- **AND** the standalone opportunities surface identifies the evidence as unavailable rather than emitting placeholder evidence or a synthetic verdict

#### Scenario: Weekly artifact enriches a niche
- **WHEN** a weekly collector artifact contains qualifying cited evidence for a niche
- **THEN** the system computes and displays its verdict, confidence, evidence mix, and next validation step from that artifact

#### Scenario: Verdict mapping is deterministic
- **WHEN** a cited niche has demand ≥ 0.5, competition gap ≥ 0.4, and a first SKU
- **THEN** the verdict is `test`
- **WHEN** a cited niche has demand < 0.3 or competition gap < 0.2
- **THEN** the verdict is `avoid`
- **WHEN** a cited niche has demand ≥ 0.3 but missing corroboration
- **THEN** the verdict is `watch`
