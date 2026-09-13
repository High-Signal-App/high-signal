# High Signal

Product specification updated: 2026-09-13

High Signal is a news media product. It turns noisy public information into a daily evidence-backed edition and keeps the sources, entities, market context, and track record inspectable.

## Reader promise

For every material item, High Signal should answer:

1. What changed?
2. Who is affected?
3. Why does it matter now?
4. What evidence supports the claim?
5. What remains uncertain?
6. When the item makes a directional call, what does the historical track record show?

## Coverage

- Technology: launches, failures, adoption, standards, infrastructure, and regulation.
- Startups: companies, funding, products, demand, and business-model shifts.
- Finance: companies, sectors, capital expenditure, macro context, equities, and prediction-market context.
- Community behavior: repeated, source-linked demand or cultural shifts that improve the edition.

## Product surfaces

The primary reader path is:

- Daily Brief
- Signals and proof pages
- Track Record

Sources, methodology, and the public API are verification utilities. Supporting
research indexes include Company Universe, markets, equities, entities, sectors,
convergence, communities, and unmapped-entity review. They remain addressable
and may be linked from relevant evidence, but they are not global navigation or
separate product promises. Operator review, backtests, and community curation
are protected workflows.

There are no reader accounts, personalized editions, paid tiers, or connected-brand sections.

## Core objects

- **Event**: normalized observation from a source.
- **Signal candidate**: a possible actionable conclusion derived from events.
- **Published signal**: a reviewed claim with evidence, uncertainty, affected entities, and optional direction.
- **Evidence bundle**: public source links and provenance for a claim.
- **Daily Brief snapshot**: the dated reader edition.
- **Track-record result**: a matured outcome tied to a prior directional signal.
- **Community digest**: operator-curated, source-linked community context used by the brief.
- **Market context**: equity and prediction-market context used in reporting.

## Evidence rules

- Cite or kill: a signal needs at least two distinct public evidence URLs and independent origins.
- Attention sources may raise investigation priority; they do not become proof by themselves.
- Failed or unavailable inputs remain explicit. Empty and unavailable states cannot be replaced with fabricated content.
- Published signal markdown is append-only. Corrections supersede earlier claims and cite them.
- Direct hit rates appear only when the exact signal type has enough matured outcomes.

## Data ownership

- Git owns published signal markdown and committed derived artifacts.
- D1 owns the queryable event, signal, evidence, entity, community, market, company, and audit indexes.
- `data/equities-snapshot.jsonl` is the only scheduled equity-price ingress. Market pages and derived artifacts consume it.
- Prediction-market probabilities remain separate from equity prices and cannot independently support a published claim.
- Reddit archives currently support Community Intelligence. Reddit Insights is the intended future owner of raw Reddit collection and history, but the migration must preserve the current digest and brief contract first.

## Product boundaries

Mentionpilot owns brand monitoring, AI visibility, evidence-readiness audits, competitor prompt sets, and competitor perception.

High Signal does not own:

- personal product recommendations or operator command briefs;
- generic idea ranking;
- generic reel or content generation;
- D2C niche opportunity scoring;
- a local experimental Lab substrate;
- brand or agent-evaluation products.

Historical migrations and plans for retired systems remain in git for auditability. Active code does not expose their routes or scheduled jobs. Removing old production tables requires a separately approved migration and backup decision.

## Operating model

- Public reading is free and anonymous.
- Cloudflare Access protects bounded operator paths.
- GitHub Actions performs source ingestion, publishing, validation, market refresh, and scoring.
- Deployment stays manual and requires a successful CI run for the exact revision.
- New sources must specify their canonical key, freshness expectation, dedupe rule, editorial use, and culling rule.

The detailed product direction lives in `docs/product/direction.md`; current implementation status lives in `PROJECT_STATUS.md`.
