## 1. Shared Contract And Seed Data

- [x] 1.1 Add `packages/shared/src/content/d2c-opportunities.ts` with the 20 India D2C niche seeds (slug, category, targetUser, problem, firstSku, risks, nextValidationStep, default scores).
- [x] 1.2 Add a deterministic `scoreD2CNiche` + `verdictForScore` pure function (0–100 + `test/watch/avoid`).
- [x] 1.3 Add `composeD2COpportunityBrief` that turns a niche + optional weekly evidence into an `OpportunityBriefPayload` (reusing the existing contract).
- [x] 1.4 Add `d2cBriefItems(region, limit, artifact?)` returning `BriefIdeaItem[]` with `opportunity` populated.
- [x] 1.5 Re-export from `packages/shared/src/content/index.ts` and the package barrel.

## 2. Weekly Artifact Loader

- [x] 2.1 Define the `D2COpportunityArtifact` and `D2CNicheEvidence` TypeScript shapes (mirror the Python collector's JSON schema).
- [x] 2.2 Add `loadLatestD2CArtifact()` that reads the latest dated file from `data/d2c-opportunities/` (build-time bundle for the worker; filesystem read for scripts).
- [x] 2.3 Fall back to seed-only briefs when no artifact exists.

## 3. Worker API Composition

- [x] 3.1 In `workers/api/src/routes/brief.ts`, merge India D2C briefs into section 02 for `region=south-asia` (up to 3) and `global` (1 rotating).
- [x] 3.2 Preserve existing community-digest and fallback behavior; India D2C briefs prepend, they do not replace real D1 ideas beyond the reserved slots.

## 4. Web Rendering

- [x] 4.1 Add an "India D2C Opportunity Briefs" section to `/opportunities` listing all 20 briefs.
- [x] 4.2 Reuse the existing `IdeaItem`/`OpportunityBriefPayload` rendering; no new component.

## 5. Weekly Collector (Python)

- [x] 5.1 Add `python/ingest/src/high_signal_ingest/d2c_opportunities.py` with the 20-niche seed table (mirrors the TS seed) and per-niche Reddit/HN/Product Hunt keyword queries.
- [x] 5.2 Write `data/d2c-opportunities/<YYYY-MM-DD>.json` with one entry per niche: evidence URLs, snippets, source class, scores (or `null` for fragile sources with `freshnessDate`).
- [x] 5.3 CLI: `uv run python -m high_signal_ingest.d2c_opportunities [--days 7] [--limit 20] [--out data/d2c-opportunities]`.
- [x] 5.4 No impuls8 requests; no paid sources; fail-closed on missing optional sources.

## 6. Tests

- [x] 6.1 `packages/shared` test: scoring/verdict mapping (test/watch/avoid boundaries), seed coverage (20 niches, each has a brief), artifact enrichment replaces placeholder evidence.
- [x] 6.2 `workers/api` brief test: `south-asia` brief includes ≥ 1 India D2C idea; `global` includes 1; no impuls8 dependency.
- [x] 6.3 Python test: collector dry-run produces a valid artifact with the expected schema (mocked HTTP).

## 7. Verification And Status

- [x] 7.1 Run `pnpm typecheck`, `pnpm test`, `pnpm lint`; `uv run pytest python/ingest/tests/test_d2c_opportunities.py`.
- [x] 7.2 Update `PROJECT_STATUS.md` with the shipped feature and timeline entry.

## 8. Slice 3 — D1 Persistence + History

- [x] 8.1 Add migration `0016_d2c_opportunities.sql` with `d2c_niches` + `d2c_niche_snapshots` tables (additive, no changes to existing rows).
- [x] 8.2 Add Drizzle schema for `d2cNiches` + `d2cNicheSnapshots` in `packages/db/src/schema.ts`.
- [x] 8.3 Add `computeD2CDelta`, `computeD2CDeltas`, `assessAging`, `verdictImproved`, `buildSnapshotRecord` to `@high-signal/shared` (pure functions for score deltas, verdict changes, aging).
- [x] 8.4 Add `scripts/sync-d2c-opportunities.ts` that loads the latest JSON artifact into D1 (idempotent upsert by niche + snapshot_date).
- [x] 8.5 Add `GET /d2c/opportunities` and `GET /d2c/opportunities/:slug` routes that read from D1 with seed-fallback.
- [x] 8.6 Update `/opportunities` page to fetch from the live API and render score deltas, verdict changes, and aging.
- [x] 8.7 Add `.github/workflows/cron-d2c-opportunities.yml` (weekly Monday cron: collect → bundle → sync → commit).

## 9. Slice 4 — Agent-Visibility Overlay

- [x] 9.1 Add `d2c_agent_visibility` table to migration 0016 (one row per niche × platform × run_date).
- [x] 9.2 Add Drizzle schema for `d2cAgentVisibility`.
- [x] 9.3 Add `buildAgentVisibilityPrompt`, `extractRecommendedBrands`, `extractCitedUrls`, `agentVisibilityGapScore` to `@high-signal/shared`.
- [x] 9.4 Add `python/ingest/src/high_signal_ingest/d2c_agent_visibility.py` runner that asks each configured AI assistant "What are the best <category> brands in India for <target user>?" and writes `data/d2c-agent-visibility/<YYYY-MM-DD>.json`.
- [x] 9.5 Add `scripts/sync-d2c-agent-visibility.ts` that persists the overlay into D1.
- [x] 9.6 Add `GET /d2c/agent-visibility` route.
- [x] 9.7 Fold the agent-visibility gap score into the Opportunity Brief (override the weekly snapshot's `agentVisibilityScore` when the overlay has run more recently).
- [x] 9.8 Render the agent-visibility gap + recommended brands in `/opportunities`.
- [x] 9.9 Wire the agent-visibility runner into the weekly cron workflow.

## 10. Slice 3 + 4 Tests

- [x] 10.1 TS tests: `computeD2CDelta` (new/improved/degraded/verdict-change), `verdictImproved`, `computeD2CDeltas`, `assessAging` (aged-well/poorly/stable/insufficient), `buildSnapshotRecord` (seed-only + with-evidence).
- [x] 10.2 TS tests: `buildAgentVisibilityPrompt`, `extractRecommendedBrands` (numbered/bold/empty), `extractCitedUrls`, `agentVisibilityGapScore` (monotonic, wide-open, saturated).
- [x] 10.3 Python tests: `test_d2c_agent_visibility.py` (prompt, extraction, gap score, no-impuls8).
- [x] 10.4 Full verification: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `uv run pytest`, `uv run ruff`.

- [ ] 10.5 Archive the OpenSpec change (after user review).
