## 1. Shared contracts

- [x] 1.1 Add pure retry eligibility, opaque token, and compact daily-digest helpers with focused tests
- [x] 1.2 Add pure durable retry-schedule calculation and eligibility coverage

## 2. Worker delivery APIs

- [x] 2.1 Preserve or issue RSS tokens during authenticated RSS preference writes
- [x] 2.2 Add owner-scoped conditional manual retry and authenticated compact digest routes
- [x] 2.3 Add migration/schema support for `delivery_log.next_attempt_at` and enforce it in cron/result writes

## 3. Private feed transport

- [x] 3.1 Extend worker RSS/Atom routes with token-authenticated daily-brief rendering while preserving public no-token behavior
- [x] 3.2 Forward token-bearing same-origin web feed requests to the worker with private cache headers

## 4. Delivery settings

- [x] 4.1 Add failed-row retry state/actions and explicit feedback to `/settings/delivery`
- [x] 4.2 Add private RSS/Atom token issuance and feed links to `/settings/delivery`

## 5. Verification and status

- [x] 5.1 Run the focused delivery test suite, API/web typechecks, and strict OpenSpec validation
- [x] 5.2 Update `PROJECT_STATUS.md` to distinguish completed local behavior from remaining operator setup
- [x] 5.3 Re-run full typecheck/tests/strict validation and record migration 0019 as an unapplied release gate
