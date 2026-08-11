## 1. Shared feed contract

- [x] 1.1 Add the typed four-feed registry, supported/default cadence rules, period keys, edition metadata, and feed response contract to `@high-signal/shared`.
- [x] 1.2 Add pure UTC daily/ISO-week/calendar-month boundary helpers plus validation for feed, cadence, period, and region inputs.
- [x] 1.3 Add deterministic timestamp filtering, stable-identity de-duplication, latest-representation selection, and contributing-edition provenance helpers.
- [x] 1.4 Cover the registry, unsupported cadence fallback, period boundaries, out-of-period exclusion, de-duplication, and empty/unavailable state rules with focused unit tests.

## 2. Public-data parity baseline

- [x] 2.1 Add the typed parity manifest for the seven approved reference products with official URLs, verification date, mapped source IDs or owning capabilities, scoped status, and explicit limitations.
- [x] 2.2 Add a regression test that validates every covered source-backed capability against the generated source catalog and rejects empty mappings or unsupported parity claims.
- [x] 2.3 Add a durable public-data parity methodology page that separates public capability coverage from source-volume, latency, language, premium-data, and restricted-platform gaps.

## 3. Bounded feed API

- [x] 3.1 Add a read-only Worker route for current and archived feed editions using bounded `daily_brief_snapshots` range queries and current edition-receipt validation.
- [x] 3.2 Preserve daily fast-path behavior, filter the selected feed sections, and return complete/in-progress period metadata plus contributing daily dates.
- [x] 3.3 Compute an evidence-derived coverage receipt with configured/contributing source classes, unique evidence domains, and feed-relevant parity gaps.
- [x] 3.4 Add API tests for all four feeds, supported and unsupported cadence combinations, invalid period inputs, sparse periods, legacy invalid snapshots, regions, deterministic duplicate handling, and coverage receipts.
- [x] 3.5 Add the typed web API client method without changing existing `/brief/daily` consumers.

## 4. Feed reading routes

- [x] 4.1 Create current and archived `/feeds/<feed>/<cadence>` routes with bounded metadata, canonical URLs, region preservation, and explicit 404/empty/unavailable states.
- [x] 4.2 Add the compact edition switcher that separates feed and cadence controls, explains slower cadences, and keeps `/` as the default current Daily Brief.
- [x] 4.3 Render period identity, complete/in-progress status, UTC bounds, contributing daily-edition links, and the compact coverage receipt without adding generated summary claims.
- [x] 4.4 Reuse the existing brief sections so each focused feed exposes the same item copy, evidence links, and provenance as its source daily editions.

## 5. Brief and Newspaper layouts

- [x] 5.1 Create the preserve-lane design receipt and capture the current brief at 390, 768, and 1440 pixels before UI edits.
- [x] 5.2 Add an accessible Brief/Newspaper control with Brief as the no-storage/no-JavaScript default and a guarded local preference.
- [x] 5.3 Implement Newspaper mode as a lead-plus-columns CSS composition over the same semantic DOM and item order; collapse both modes to one column on narrow screens.
- [x] 5.4 Ensure layout selection does not alter API requests, canonical URLs, metadata, evidence visibility, or anonymous cache keys.

## 6. Verification and durable truth

- [x] 6.1 Run the smallest shared, parity, and Worker test suites first, then web typecheck and build checks relevant to the changed routes.
- [x] 6.2 Inspect current and archived daily/weekly/monthly feeds in a browser at 390, 768, and 1440 pixels; capture after evidence and verify keyboard/focus behavior and no horizontal overflow.
- [x] 6.3 Run Impeccable critique, polish, audit, and the mechanical detector; resolve all P0/P1 findings and record scores and advisory findings in the design receipt.
- [x] 6.4 Update `docs/product/direction.md`, archive/navigation copy, and `PROJECT_STATUS.md` only after the behavior is complete and verified.
- [x] 6.5 Validate and archive the OpenSpec change after all checks pass, then run `pnpm docs:check`; do not commit, push, deploy, migrate, or release without a separate explicit request.
