## Why

Plan 0009 promises that failed deliveries are retryable from `/settings/delivery`, that automatic retries respect 15-minute/1-hour/4-hour eligibility, and scopes private per-user RSS plus a compact JSON digest. The current implementation stops at attempt capping without durable elapsed backoff, has no manual retry, and exposes only public weekly-signal feeds. Closing these local gaps makes the checked-in product match the authoritative PRD while leaving provider, DNS, migration application, and deployment work untouched.

## What Changes

- Add an authenticated manual retry endpoint that only retries the signed-in user's failed email delivery, preserves the original log identity, increments the attempt, and returns an explicit result.
- Persist each failed row's next automatic attempt time and refuse cron retries before that durable eligibility timestamp.
- Add a retry action and deterministic retry feedback to failed rows on `/settings/delivery`.
- Issue and persist an opaque per-user RSS token through the existing delivery preferences API and expose token-authenticated daily-brief RSS/Atom feeds.
- Add an authenticated compact daily-brief JSON representation for future internal transports, containing the same ordered public/personal brief sections and evidence links without email or delivery metadata.
- Add focused tests for durable automatic/manual retry eligibility, opaque token handling, and compact digest composition.

## Capabilities

### New Capabilities

- `brief-delivery-completion`: Durable automatic retry scheduling, manual failed-delivery retry, private token-authenticated feeds, and compact daily-brief JSON output.

### Modified Capabilities

None.

## Impact

- Worker delivery and digest routes under `workers/api/src/routes/`.
- Additive D1 migration and Drizzle schema field for `delivery_log.next_attempt_at`; authored locally but not applied.
- Delivery settings UI and its existing authenticated Next.js proxy.
- Pure delivery helpers and focused plan 0009 tests.
- Existing `delivery_preferences.rss_token` storage; no dependency, secret, production configuration, migration application, or deploy change.
