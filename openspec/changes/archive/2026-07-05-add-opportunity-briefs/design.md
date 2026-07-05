## Context

The Daily Brief already has a public "business ideas to build" section backed by `BriefIdeaItem`, `fallbackIdeas()`, and `buildIdeas()` from public community digests. The current contract is intentionally light: title, description, source, region, subreddit, surfaced date, and evidence URLs. That is useful for discovery, but not yet enough to make a decision.

High Signal's product direction favors evidence-first synthesis over broad directories. Opportunity Briefs should therefore enrich the existing section 02 rather than introduce a new directory or data ingestion system in this slice.

## Goals / Non-Goals

**Goals:**

- Add a backward-compatible `opportunity` payload to `BriefIdeaItem`.
- Populate seeded fallback ideas with decision-grade Opportunity Brief fields.
- Populate real digest-derived ideas with conservative defaults so the API shape is stable before source-specific extraction improves.
- Render the richer fields in the existing brief cards without changing navigation or requiring auth.
- Cover the new contract with focused unit tests.

**Non-Goals:**

- No new database tables or migrations.
- No new external data providers.
- No automated LLM generation of opportunity briefs in this slice.
- No full impuls8-style brand/category directory.
- No paid/pro gating.

## Decisions

1. Keep Opportunity Briefs inside `BriefIdeaItem`.
   - Rationale: `/brief/daily` is already the canonical public daily surface and precompute path. Extending the existing item avoids another endpoint and keeps delivery/RSS/email consumers on one contract.
   - Alternative considered: add a separate `/opportunities/briefs` route. Rejected for this MVP because it would fork composition and cache behavior before the contract proves useful.

2. Make the new fields optional at the TypeScript boundary.
   - Rationale: precomputed snapshots, email delivery snapshots, and any stale JSON can still omit the enrichment. Renderers can progressively enhance when `item.opportunity` exists.
   - Alternative considered: require every idea to include all fields. Rejected because old cached snapshots would become brittle.

3. Use structured, small arrays for evidence and decision fields.
   - Rationale: cards need scannable fields: verdict, confidence, target user, problem, why-now reasons, evidence counts, competitor/pricing/agent visibility, risks, next step, and hit-rate context.
   - Alternative considered: a single markdown blob. Rejected because the UI, email delivery, and tests need stable fields.

4. Seeded fallback data demonstrates the full experience.
   - Rationale: the public brief must stay useful in empty-D1 environments and anonymous demos. Seeded Opportunity Briefs are the quickest way to prove the shape without adding ingestion complexity.
   - Alternative considered: only enrich real D1 rows. Rejected because local/dev/empty deploys would hide the feature.

## Risks / Trade-offs

- [Risk] Real digest-derived items may look less complete than seeded items initially. → Mitigation: assign conservative defaults and show richer fields only when present.
- [Risk] More card content can make section 02 visually heavy. → Mitigation: compact label/value rows, short arrays, and no nested card layout.
- [Risk] Seeded evidence can be mistaken for live proof. → Mitigation: preserve source links and dates, and keep copy framed as validation targets.
- [Risk] Opportunity fields may later need first-class persistence. → Mitigation: keep the shape serializable and small so it can map to D1 later without reworking the UI.

## Migration Plan

Ship as an additive contract change. No database migration is required. Rollback is deleting the optional fields and renderer blocks; old brief items remain valid.

## Open Questions

- Which source-specific extractors should fill competitor/pricing/agent-visibility fields first: community digests, app reviews, or agent visibility reports?
- Should `/opportunities` eventually consume the same Opportunity Brief contract, or remain broader product-opportunity synthesis?
