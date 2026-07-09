## Why

The generated company universe is useful only for companies already present in
the batch artifact. A brand operator expects to type a company name or domain
and get the same High Signal treatment: persisted company profile, source
boundary, competitors, and a clear freshness state. Returning "not found" or a
raw JSON artifact breaks the product promise.

## What Changes

- Add a lookup-or-create flow for the company universe.
- Existing companies return from D1 immediately.
- Unknown companies are normalized, inserted into D1 as `pending_enrichment`,
  given a first-pass High Signal-generated competitor map, and returned to the
  caller.
- The generated profile records provenance (`source=operator-submitted`) and
  timestamps (`requested_at`, `last_enriched_at`, `updated_at`) so the UI can
  show freshness honestly.
- Add a web entry point on `/case-studies` that lets a user enter a company
  name or domain and navigates to the resulting company page.

## Capabilities

### Added Capabilities

- `company-lookup-create`: user-entered companies can be resolved or created
  into the D1-backed company universe with competitors.

## Impact

- DB: additive migration for company status/request fields. Existing generated
  rows remain valid.
- Worker API: `POST /company-universe/lookup` plus detail payload status fields.
- Web: company lookup form on `/case-studies`; detail pages can render
  generated or pending companies from the static artifact today, and the API
  returns on-demand rows for app flows.
- Scripts: sync script marks batch rows as `generated`.
- No production migration or remote sync in this change unless the operator
  explicitly asks.
