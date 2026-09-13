# Codebase structure — what lives where

High Signal is one news and market-intelligence product.

## Deployables

| Unit | Path | Deploy |
| --- | --- | --- |
| Web app | `apps/web` | `deploy-web.yml` to Cloudflare Workers through OpenNext |
| API | `workers/api` | `deploy-api.yml` to Cloudflare Workers |
| Ingestion and scoring | `python/ingest` | GitHub Actions workflows |

Shared libraries live in `packages/shared`; the Drizzle schema and historical D1 migrations live in `packages/db`.

## Shared domains

| Folder | Owns |
| --- | --- |
| `primitives/` | Core types, region model, signal families, and helpers |
| `core/` | Brief contract, signal intelligence, provenance, and publishing contracts |
| `nlp/` | Lightweight text annotation |
| `markets/` | Equity and market-watch contracts |
| `content/` | Daily Brief seed content still used by the product |
| `traffic/` | Traffic classification and summaries |

Brand evaluation, competitor perception, and prompt-set logic now live in Mentionpilot. The retired personal, ideas, agent-eval, D2C, and Lab implementations are absent from active source.

## Product surfaces

- Reader surfaces: Daily Brief, Signals, Sources, Company Universe, and Track Record.
- Supporting research: markets, equities, entities, sectors, convergence, communities, and unmapped-entity review.
- Operator paths: publishing review, backtest workbench, and community curation behind Cloudflare Access.

Community Intelligence remains local for now. A later migration may replace its Reddit collection and history with Reddit Insights, but that migration must preserve the current digest and brief inputs before this code is removed.
