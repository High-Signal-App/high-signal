## MODIFIED Requirements

### Requirement: Brief delivery preserves intent evidence
Owner-authenticated delivery and compact digest surfaces SHALL preserve source and meaningful intent context for intent-backed items when those channels are configured to include them. The public web Daily Brief SHALL remain a non-personalized three-category edition and SHALL direct readers to dedicated Mentions and Agent Eval surfaces instead of rendering seed products, rotating spotlights, product pickers, or personalized sections.

#### Scenario: Public web brief renders
- **WHEN** an anonymous or signed-in visitor opens the public current or dated Daily Brief
- **THEN** the page renders only the public market and company, business opportunity, and behavior and culture categories
- **AND** it does not render a rotating product spotlight, product picker, brand perception section, or product-improvement section

#### Scenario: Delivered brief includes owner intent context
- **WHEN** an owner-authenticated delivery channel is configured to include intent-backed sections
- **THEN** the delivered section text identifies the intent stage and action and includes the original source URL

#### Scenario: Reader wants product-specific analysis
- **WHEN** a public brief reader follows the contextual Mentions or Agent Eval link
- **THEN** the reader reaches the dedicated product-analysis surface rather than a personalized public brief variant
