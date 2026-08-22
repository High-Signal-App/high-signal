---
title: Cloudflare Access operator gate
description: Configure and verify the single-operator Access application and its Infisical-managed values.
---

# Cloudflare Access operator gate

High Signal has no reader accounts. Cloudflare Access protects only the
operator paths; the web Worker verifies the Access JWT again before it injects
the API Worker's `ADMIN_TOKEN`.

```text
operator ──▶ Cloudflare Access ──Cf-Access-Jwt-Assertion──▶ high-signal-web
                                                           │ verify JWT
                                                           ▼
                                                    /api/admin proxy
                                                           │ ADMIN_TOKEN
                                                           ▼
                                                    high-signal-api
```

The origin verifier validates the JWT signature against the team's rotating
JWKS plus issuer, audience, expiry, and email claims. It does not trust
`Cf-Access-Authenticated-User-Email` by itself. Missing configuration, an
unavailable JWKS, and malformed, forged, wrong-audience, or expired tokens all
fail closed.

## Protected paths

Create one self-hosted public application for `highsignal.app` with these
suffix-wildcard paths (each covers the base path and its descendants):

- `/review*`
- `/personal*`
- `/backtest-workbench*`
- `/api/admin/*`

The public `/communities` and `/track-record` pages may reveal their bounded
operator controls after a valid `CF_Authorization` cookie is present, but they
remain public pages. Every readable product surface stays anonymous.

`workers_dev = false` and `preview_urls = false` must remain set on both
Workers. Access on `highsignal.app` does not protect a fallback hostname.

## Create the Access application

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications.
2. Create a self-hosted public application named `High Signal Operator`.
3. Add the hostname and paths above.
4. Attach the reusable `Allow Sarthak only` policy, whose Email selector
   contains only the operator address.
5. Accept the account's configured identity providers; Email OTP remains the
   fallback.
6. Record the application AUD tag and team domain
   (`<team>.cloudflareaccess.com`) as tracked Worker variables. Both identifiers
   are public in the Access redirect/JWT contract; they are not credentials.

Cloudflare denies unmatched users by default. The application session is 12
hours, matching the retired password session.

## Infisical ownership and sync

High Signal owns a dedicated Infisical project so this repository stays
independently operable. Infisical is the source of truth, not a second copy of
dashboard-set values. The tracked `.infisical.json` selects project
`dec85e87-28ea-4896-8b4e-d0f18afbb80a` and the `prod` environment.

Store at minimum:

| Value | Destination |
| --- | --- |
| `CF_ACCESS_AUD` | tracked `high-signal-web` Worker variable |
| `CF_ACCESS_TEAM_DOMAIN` | tracked `high-signal-web` Worker variable |
| `ADMIN_TOKEN` | both Workers and the GitHub repository |
| existing cron/source keys | GitHub repository; Modal only when a manual backfill needs them |

Provider propagation is an explicit operator operation so a rotation cannot
silently update only one consumer. Pipe values directly from Infisical to the
destination CLI; never use `--show-values`, shell tracing, or a command-line
argument containing the value. The required order is GitHub Actions, API
Worker, web Worker, and finally the Modal `high-signal` secret. Verify the new
token against `/admin/audit/summary`, confirm the prior token receives 401,
and load `/review` before declaring the rotation complete.

Modal has no partial-update CLI contract for an existing multi-key Secret. Edit
only `ADMIN_TOKEN` and `API_BASE` in the dashboard so `SEC_USER_AGENT` is
preserved, then run a bounded manual backfill and query its `ingest_runs` row.

## Verify before retiring the password gate

1. An anonymous request to every protected path redirects to Access.
2. The allowed identity reaches `/review`, `/personal`, and
   `/backtest-workbench`.
3. A non-allowed identity is denied.
4. Missing, forged, wrong-audience, and expired assertions receive 401 at
   `/api/admin/*`.
5. Both `*.workers.dev` production hostnames are unreachable.
6. A valid operator request contains `CF_Authorization` and bypasses shared
   edge-cache reads and writes.
7. A dry-run publish reaches `high-signal-api` without a 401 and without
   exposing `ADMIN_TOKEN` to the browser.
8. `pnpm quality` passes on the exact deploy SHA.

Only after those receipts exist, remove `ADMIN_PASSWORD`,
`ADMIN_SESSION_SECRET`, and any retired auth-vendor secret from
`high-signal-web`. Cloudflare secrets are write-only; verify their absence by
secret name, never by attempting to print values.

## 2026-08-22 cleanup receipt

- Infisical project `High Signal` / `prod` owns `ADMIN_TOKEN`, the active
  source credentials, and the free-AI gateway configuration.
- GitHub Actions and both Workers received the same rotated `ADMIN_TOKEN`; the
  previous Infisical copy receives 401 while the new token receives 200 from
  `/admin/audit/summary`.
- `high-signal-web` now lists only `ADMIN_TOKEN`; `ADMIN_PASSWORD`,
  `ADMIN_SESSION_SECRET`, and `CLERK_SECRET_KEY` were deleted.
- Modal's `high-signal` Secret now targets `https://api.highsignal.app` with the
  rotated token. Run `ap-TSRnnBF5BBHoputTkFd30j` completed a five-minute GDELT
  replay and persisted D1 audit row `b9bb1c6d00e7d9dd` with zero errors.

## Revocation

Remove the operator from the Access policy for browser revocation. Rotate
`ADMIN_TOKEN` through Infisical only when the API bearer may be exposed; the
rotation must reach the API Worker, web Worker, GitHub Actions, and any retained
Modal manual-backfill secret before it is complete.
