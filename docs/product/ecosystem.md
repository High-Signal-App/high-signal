# Product ownership and retirement map

Date: 2026-09-13. Planning scope: Mentionpilot, Reddit Insights, Highsignal, and the related retirements. This assigns responsibility; it does not assert that integrations are deployed or change the Fleet lifecycle catalog.

## Three core products

| Component | Decision | Owns | Intended consumers / outcome |
| --- | --- | --- | --- |
| Reddit Insights | Build collection first | Reddit roster, daily capture, durable history, coverage reporting, read API/exports; community analysis later | Mentionpilot gets Reddit evidence; Highsignal gets Reddit reporting inputs; researchers eventually compare communities over time |
| Mentionpilot | Resurrect as a focused product | Brand profiles, mentions, competitor perception, buyer-intent inbox, AI visibility, evidence audits, action history | Founders and marketing teams decide what to investigate, respond to, or improve |
| Highsignal | Keep as a news media company | Editorial selection, news, market reporting, published signals, corrections, track records and backtests | Readers understand developments and inspect the evidence and outcomes |

## External inputs

| Input | Intended use | Boundary |
| --- | --- | --- |
| F5Bot | Alert input to Mentionpilot's inbox | External supplier; validate an ingest method and deduplicate against Reddit Insights records. It is not the canonical Reddit archive. |
| Google Trends | Demand and topic context for Mentionpilot; editorial context for Highsignal where useful | External supplier. Retain query, geography, period, and retrieval time; do not equate search interest with buying intent or absolute demand. |
| Product Hunt | External launch feed used by Highsignal's existing adapter | Highsignal owns its direct source ingestion and editorial interpretation. |

F5Bot and Google Trends remain planned external inputs, not verified integrations.

## Move, retire, or defer

| Capability / product | Decision | Destination or retained responsibility |
| --- | --- | --- |
| Brand monitoring, AI visibility, competitor perception, evidence-readiness audits, brand opportunity ranking | Mentionpilot ownership | Useful primitives have been extracted locally; full product workflows and integrations still require verification |
| Community Intelligence | Keep in Highsignal now; move later | Reddit Insights eventually owns community analysis and history. Highsignal retains editorial interpretation and published stories. Migration requires digest and consumer parity. |
| Markets, equities, prediction-market context, track record and backtests | Keep in Highsignal | Support reporting and measure calls; keep equity prices separate from prediction probabilities |
| Company Universe, entities, sectors, convergence, source/evidence indexes | Keep in Highsignal where they support reporting | Highsignal owns its editorial research views and their inputs |
| Agent Data | Remain retired | Reddit acquisition and exposure belong to Reddit Insights; do not revive another data-service product |
| Personal command brief and product recommendation/idea-ranking machinery | Retire | No new owner |
| India D2C opportunity product and scoring pipeline | Retire | No new owner |
| Highsignal Lab | Retire | No replacement Lab product |
| Generic reel generation inside Highsignal | Retire | No new owner in this split; this does not retire unrelated Fleet video repositories |
| Standalone learning feed, YouTube brand-awareness probe, synthetic seed/demo content | Retire from Highsignal | Retain only core editorial source ingestion; no replacement product |
| Old Highsignal copies of Mentionpilot capabilities | Remove after preserving useful parts | Mentionpilot becomes the owner; avoid maintaining duplicate implementations |

Retirement here describes the agreed scope and local cleanup. Production shutdown, table deletion, repository archival, and deployment are separate actions and have not been established by these PRDs. Historical plans and migrations remain as records.

## Explicitly outside this decision

Knowledge Base, Starboard, Research Papers, and Highsignal Podcasts were excluded from this discussion. SaaS Ideas remains an internal idea directory. None is newly retired or migrated by this map. Excluding a product does not require removing useful editorial source adapters.

## Accountability rules

1. Reddit Insights owns Reddit records; consumers own their derived views and decisions.
2. Mentionpilot owns brand-specific prioritization and customer actions. Highsignal owns public reporting and market-call evaluation.
3. A migration closes only after the consumer works, historical coverage is preserved or its limits documented, and the replaced path can be retired without lost capability.
4. Each product's owning repository is responsible for maintenance and failures. Individual operational owners and service-level targets remain TBD.

Related Highsignal requirements: [concise PRD](prd.md), [scope reset](scope-reset.md). Mentionpilot and Reddit Insights each contain a root `PRD.md`.
