## 1. Schema And Persistence

- [x] 1.1 Add additive migration for on-demand company fields.
- [x] 1.2 Add Drizzle schema fields.
- [x] 1.3 Update company-universe sync script to mark batch rows as generated.

## 2. API Lookup/Create

- [x] 2.1 Add normalization helpers for name/domain/slug.
- [x] 2.2 Add `POST /company-universe/lookup`.
- [x] 2.3 Return status/timestamp fields from list/detail payloads.
- [x] 2.4 Generate first-pass competitors for newly-created companies.

## 3. Web Entry Point

- [x] 3.1 Add Next.js route handler that proxies lookup requests to the API.
- [x] 3.2 Add company lookup form on `/case-studies`.
- [x] 3.3 Show last-updated/status copy for the lookup flow.

## 4. Verification

- [x] 4.1 Validate generated SQL dry run and temp SQLite apply.
- [x] 4.2 Run package-local typechecks for DB, API, and web.
- [x] 4.3 Run focused Biome checks on new/changed formatted files.
- [x] 4.4 Smoke `/case-studies` and validate lookup persistence via temp SQLite.
- [x] 4.5 Update `PROJECT_STATUS.md`.
