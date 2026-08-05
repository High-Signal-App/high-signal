## ADDED Requirements

### Requirement: Distinct public intent entry points

The web application SHALL expose the approved Daily Brief, startup intelligence,
founder workflow, and technology trend pages at their exact canonical paths.
Each page SHALL have unique metadata, visible approved copy, and contextual links
into existing product and proof surfaces.

#### Scenario: A reader opens a category page

- **WHEN** a reader opens one of the four approved canonical paths
- **THEN** the page renders the matching approved title, description, sections,
  evidence boundary, CTA, and internal research path
- **AND** it does not claim unsupported rankings, outcomes, or coverage

### Requirement: One robust guide model

The implementation SHALL store guide content and metadata in one typed registry
and render it through one reusable reading component. Each public route SHALL
select an explicit registry key rather than infer content from URL ternaries or
a root catch-all.

#### Scenario: Guide content is added or changed

- **WHEN** an approved guide entry changes
- **THEN** the corresponding HTML, metadata, schema inputs, and visible sections
  derive from that entry
- **AND** other guides retain their own explicit content and intent

### Requirement: Discovery surfaces agree

Every new guide route SHALL appear in the public route registry, canonical
sitemap, agent catalog, and rendered Markdown boundary. Its canonical HTML and
Markdown alternate SHALL describe the same visible page.

#### Scenario: A crawler discovers a guide

- **WHEN** a crawler reads the sitemap or `/api/ai`
- **THEN** it finds the canonical guide URL and Markdown alternate
- **AND** the route remains indexable under the static public-route policy

### Requirement: AI readiness remains distinct from awareness

The existing `/agent-eval/seo` page SHALL preserve its live audit behavior and
SHALL explain that technical SEO/GEO readiness does not prove indexing, ranking,
provider mentions, or citations.

#### Scenario: The audit returns a strong technical grade

- **WHEN** a URL receives a strong SEO or GEO readiness score
- **THEN** the page describes the technical primitives measured
- **AND** it does not represent the grade as observed search or AI awareness

### Requirement: Incumbent visual and interaction system is preserved

The new surfaces SHALL use the High Signal dark zinc field, restrained cyan
accent, Geist typography, square one-pixel boundaries, readable body measure,
and visible keyboard focus. They SHALL introduce no decorative shadow,
gradient, glass treatment, large rounded container, or decorative motion.

#### Scenario: A guide is viewed responsively

- **WHEN** the page is viewed at 390, 768, or 1440 CSS pixels
- **THEN** all approved content and links remain readable and operable
- **AND** the composition remains consistent with existing public surfaces
