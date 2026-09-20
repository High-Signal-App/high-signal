---
title: "How to Map Second-Order Spillovers from a Company Event"
slug: "how-to-map-second-order-spillovers-from-a-company-event"
target_query: "how to map second-order spillovers company event"
search_intent: "Informational - Readers are looking for a structured methodology to trace the downstream effects of corporate news across supply chains and competitor networks."
meta_title: "How to Map Second-Order Spillovers from a Company Event"
meta_description: "Learn how to build a spillover map that traces the impact of a company event through its supplier, customer, and peer networks."
---

## Outline

1. **Introduction**: Moving beyond the headline to understand downstream consequences.
2. **The Mechanics of a Spillover Map**: Defining the entity graph and relationship edges.
3. **Identifying the Catalyst**: Distinguishing material events from market noise.
4. **Tracing the Impact**: Step-by-step evaluation of suppliers, customers, and peers.
5. **A Concrete Example**: The TSMC capex ripple effect.
6. **Common Challenges**: Handling noise, timing, and unverified edges.
7. **Next Action**: A practical starting point for building your map.
8. **Internal-Link Suggestions**: Where this fits into broader research.
9. **Source Notes (Internal)**: Repository evidence supporting this draft.

## Introduction

When a major company announces a material event, the immediate reaction focuses on that single entity. The stock moves, headlines summarize the press release, and the initial wave of attention dissipates quickly. However, the most actionable intelligence rarely lies in the direct impact alone. It resides in the second-order spillovers.

A second-order spillover occurs when an event at one company systematically affects its network. If a semiconductor foundry expands its capital expenditures, the direct impact is on its own capacity. The second-order spillover is the demand surge for the equipment manufacturers supplying the foundry, the subsequent availability of memory for downstream customers, and the power requirements imposed on local grids.

Mapping these spillovers transforms an isolated news alert into a predictive framework. Instead of reacting to a single price movement, an analyst can trace the consequences through a directed graph of relationships. This article details the mechanics of constructing a spillover map, identifying the right catalysts, and tracing the impacts through supplier, customer, and peer networks.

## The Mechanics of a Spillover Map

A functional spillover map requires two structural components: a constrained entity graph and explicitly defined relationship edges.

If you attempt to map every company in the global economy simultaneously, the resulting graph becomes an unusable web. The most effective maps begin with a focused, tractable entity graph. By limiting the scope to a specific sector or a bounded list of critical companies, you maintain high-fidelity tracking.

Once entities are defined, they must be connected by typed relationship edges. A spillover map relies primarily on three types of edges:

1. **Supplier Edges**: Upstream companies providing the raw materials, components, or specialized equipment required by the primary entity.
2. **Customer Edges**: Downstream companies relying on the primary entity's output to build their own products or services.
3. **Peer Edges**: Competitors or adjacent market participants who may benefit from the primary entity's missteps or suffer from its pricing power.

A robust spillover map is directed. The relationship is not merely "Company A is related to Company B." It must state "Company A supplies Company B," meaning an event restricting Company A's output directly threatens Company B's supply chain.

## Identifying the Catalyst

Not every press release qualifies as a catalyst for a spillover map. To avoid polluting the map with noise, events must clear a strict materiality threshold.

Material events typically manifest as structural changes to a business. Examples include:
- **Capital Expenditure (CapEx) Revisions**: Significant increases or decreases in planned infrastructure spending.
- **Product Launch or Deprecation**: The introduction of a market-shifting capability or the removal of a widely used API.
- **Supply Chain Disruptions**: Verified halts in production, tariffs, or raw material shortages.
- **Regulatory Actions**: Antitrust rulings, export controls, or new compliance mandates.

To ensure the catalyst is real, it must be supported by evidence. A strict "cite-or-kill" rule is invaluable here. If an event cannot be verified by at least two independent sources—such as an SEC filing, an official investor relations page, or a primary-source announcement—it should not trigger a spillover analysis. Attention and social media chatter do not constitute evidence. Only structured, verifiable facts should initiate the mapping process.

## Tracing the Impact

Once a verified catalyst is identified, trace the event across the defined relationship edges. This requires evaluating the logical consequences for each connected entity.

### 1. Evaluating Supplier Edges
When the primary entity expands operations, suppliers are the first to feel the demand pull. You must ask: Which vendors provide the critical bottlenecks? If a company announces a massive data center buildout, the spillover isn't generic "hardware." It flows to specific suppliers of cooling systems, power delivery components, and specialized silicon. Conversely, if a major customer cancels an order, the supplier edge transmits a negative shock. The map should highlight suppliers with high revenue concentration tied to the primary entity.

### 2. Evaluating Customer Edges
Customer spillovers involve pricing, availability, and capability. If a supplier raises prices, the customer edge dictates margin compression for the downstream entities unless they possess pricing power. If a supplier releases a breakthrough component, the customer edge identifies which downstream companies are unblocked to build new features. Identifying these downstream dependencies allows you to anticipate product cycle accelerations or delays before they are formally announced.

### 3. Evaluating Peer Edges
Peer spillovers are characterized by substitution and market share dynamics. An event that damages the primary entity—a data breach, a regulatory fine, or a service outage—creates an immediate vacuum. The peer edge points to the competitors positioned to capture the stranded customers. Alternatively, if the primary entity drastically lowers prices, the peer edge signals impending margin pressure across the sector.

## A Concrete Example: The Semiconductor Ripple Effect

To illustrate this methodology, consider a historical pattern in the semiconductor industry. This is a classic, news-dense, and spillover-dominant environment.

**The Catalyst**: A major semiconductor foundry (Entity A) announces a multi-billion dollar increase in capital expenditure to build next-generation fabrication plants.

**First-Order Impact**: The foundry's own financials are impacted. The market digests the upfront cost versus the long-term capacity expansion.

**Second-Order Spillovers (Supplier Edges)**:
- The foundry cannot build the plant without specialized photolithography equipment. The spillover map points to the sole-source manufacturer of this equipment (Entity B).
- The fabrication process requires specialized chemicals and gases. The map highlights the niche materials suppliers (Entity C).

**Third-Order Spillovers (Customer Edges)**:
- With expanded capacity, the foundry can produce more high-bandwidth memory (HBM) and advanced logic chips. This unblocks supply constraints for major cloud computing providers (Entity D).
- As cloud providers deploy more advanced chips, their power consumption density increases, triggering a tertiary spillover to companies manufacturing advanced liquid cooling infrastructure and local utility providers (Entity E).

By tracing the event through the graph (Foundry CapEx → Lithography Supplier → Cloud Infrastructure → Power/Cooling), the map reveals actionable insights far beyond the initial announcement.

## Common Challenges

While the logic of a spillover map is straightforward, the execution is fraught with practical challenges.

**The Noise Problem**: The most common error is conflating a simple mention with a material relationship. Just because two companies are mentioned in the same news article does not mean a valid edge exists. Edges must be verified through supply chain analysis, regulatory filings, or explicit partnerships.

**Unverified Edges**: When a new connection is discovered, it should be treated with skepticism. A best practice is to flag newly identified spillover edges as "unverified" until they undergo rigorous review. Operating with unverified edges risks generating false positives across the entire graph.

**The Timing Gap**: Second-order effects do not manifest immediately. While the stock of the primary entity may gap up at the open, the supplier or customer impact might take weeks to become obvious, and months to appear in quarterly earnings. The map provides the direction, but it does not guarantee the exact timing.

**Over-Mapping**: Attempting to trace impacts to the fourth or fifth order usually results in degraded signal quality. The chain of causality becomes too weak, and exogenous variables overwhelm the original catalyst. Focus deeply on the direct impact and immediate second-order spillovers rather than attempting to model the entire macroeconomic environment.

## How High Signal Approaches Spillovers

High Signal is designed specifically to capture these dynamics. Instead of merely aggregating news, it constructs a directed spillover graph explicitly modeling the event, the direct impact, and the second-order entities via supplier, customer, and peer edges.

The process begins with an evidence-first ingest layer. High Signal monitors SEC filings, investor relations pages, government APIs, and other primary sources. When an event is detected, it must pass a strict "cite-or-kill" quality gate, requiring at least two independent sources before it is published.

Once verified, the event is mapped against a constrained entity graph of technology, startup, and finance companies. The system extracts the relationships and predicts the directional impact. Because the spillover graph is directed, High Signal can distinguish between a supplier bottleneck and a customer demand surge.

Crucially, High Signal does not rewrite history. It maintains a versioned signal memory. Corrections are issued as new signals citing the prior event. Every directional call is tracked, and the platform maintains a public hit-rate ledger. By measuring predictions against actual outcomes, the spillover map is continuously calibrated, allowing operators to see exactly which types of events yield the most reliable second-order signals.

## Next Action

To begin mapping spillovers, start small. Select one focal company that you understand deeply. Identify its top three suppliers, its three largest customers, and its two most direct peers. Write these down as explicit, directed edges. The next time that focal company reports earnings or announces a material change, do not look at its stock price. Instead, trace the event through your nine defined edges and document the logical consequences for the network.

## Internal-Link Suggestions

- Link the discussion of "cite-or-kill" to the `/methodology` page to explain the two-source verification rule.
- Link the "Public hit-rate ledger" mention to the `/track-record` page to demonstrate how predictions are measured.
- Link the concept of the "constrained entity graph" to the `/case-studies` or `/company-universe` directory to show the scope of tracked companies.

## Source Notes (Internal)

- **Spillover Concept**: Driven by `README.md` ("Predicts direction + 2nd-order spillover via supplier/customer/peer graph") and `agents.md` ("Spillover map — event → direct impact → 2nd-order entities via supplier/customer/peer edges").
- **Entity Graph**: Supported by `README.md` ("Small entity graph (~150 names) — tractable solo").
- **Cite-or-Kill / Evidence**: Rooted in `agents.md` ("Evidence-first — no signal ships without ≥ 2 cited sources") and `PRODUCT.md` ("Cite or kill").
- **Unverified Edges**: Described in `agents.md` ("Quality gates: Spillover edges flagged `unverified` until reviewed once").
- **Hit-Rate Ledger**: From `agents.md` ("Public hit-rate ledger from day 1") and `PRODUCT.md` ("The public methodology and hit-rate definitions live at `/methodology` and `/track-record`").
- **Versioned Memory**: Based on `agents.md` ("Versioned signal memory — signal log is git; corrections are new signals citing prior").
- **Limitations**: Kept within the boundaries established in `PRODUCT.md` and `PROJECT_STATUS.md`. No claims were made about predictive AI perfection, massive macroeconomic graphs, or paid features (as High Signal is free and bounded to tech/startups/finance).
