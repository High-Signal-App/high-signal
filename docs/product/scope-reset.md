# High Signal scope reset

Date: 2026-06-03

Purpose: reduce the project back to a coherent product without throwing away useful work. This is a product-scope decision, not a deletion plan.

## Active product

High Signal is one product: an evidence-backed daily intelligence brief.

The active product answers:

1. What changed?
2. Who is affected?
3. What is worth watching?
4. What does the track record say about this kind of signal?
5. For a connected brand, how does the market and AI-agent layer perceive it?
6. For a connected brand, what should be improved so humans and agents can understand, cite, and recommend it?

## Active surfaces

| Area | Status | Reason |
| --- | --- | --- |
| Daily brief | Active | Main product surface |
| Signals | Active | Core insight object |
| Evidence | Active | Cite-or-kill foundation |
| Track record / hit-rate | Active | Quality moat |
| Small source pipeline | Active | Feeds the brief; source volume is not the goal |
| Mentions | Active | Feeds brand perception and share-of-voice |
| Agent eval | Active | Feeds product-improvement ideas and agent-readiness |
| Markets lens | Active but narrow | Only insofar as it supports "stocks watching for a boom" and market context |

## Parked areas

Parked means:

- Keep the code and data.
- Do not delete working routes.
- Remove from primary product focus/navigation where practical.
- Do not expand unless the parked area is required by the active brief.
- Treat future work as separate approval, not automatic continuation.

| Area | Parked stance | Allowed use |
| --- | --- | --- |
| Lab | Parked | Optional local discovery substrate; not part of the product path |
| Personal/operator cockpit | Parked | Internal-only workflow; not a customer-facing product |
| Standalone equities UI | Parked | Market data can feed the brief; no broad stock terminal expansion |
| Standalone communities product | Parked | Community data may feed ideas/trends; no separate community product push |
| Broad source expansion | Parked | Freeze "add more sources" unless a source improves corroboration, novelty, entity coverage, or hit-rate |

## Boundary rules

1. More data is not the product. Better insight is the product.
2. Mentions and agent eval are active only because they produce brief sections 4 and 5.
3. Communities are an input, not a destination.
4. Equities are an input to market signals, not a stock terminal.
5. Lab is a substrate experiment, not a product dependency.
6. Personal workflows are operator tooling, not product scope.
7. A new source must state its canonical key, freshness expectation, dedupe rule, use in the brief, and culling rule before it is added.

## Implementation implication

The repo can stay consolidated for now, but the navigation and docs should reflect the active product:

- Keep: brief, markets, mentions, agent eval, track record, review.
- De-emphasize: communities and lab.
- Keep direct URLs available for parked areas while decisions settle.

The next cleanup should be semantic, not expansive: clarify `events` as source observations versus actionable normalized events, and keep source-of-truth ownership clear for market/equity data.
