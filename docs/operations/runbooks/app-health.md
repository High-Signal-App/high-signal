---
title: App Health integration
description: Activate and observe Highsignal analytics, endpoint health, logs, and bot traffic.
---

# App Health integration

Status: production integration and live receipt checks verified on September 12, 2026. Tracking: [issue #178](https://github.com/High-Signal-App/high-signal/issues/178).

## Surfaces

Select Highsignal / production in App Health:

- Analytics: page views, live presence, visits and referring domains from the browser tracker.
- Events: `source.opened`, `signal.opened`, `source.explored`, `company.opened`,
  `archive.opened`, and `history.unlocked`. Actions carry fixed names, not clicked
  URLs, link text, form inputs, or query values.
- Endpoint health: `/web/...` and `/api/...` route templates distinguish the two
  services. Gateway instrumentation includes handled cache responses and errors.
- Logs: existing history access outcomes plus `traffic.summary`, with `surface`
  identifying web or API. Select that event to inspect the coarse bot counters.
- Footer: Live analytics opens App Health's revocable public aggregate viewer.
  Its token is in the URL fragment. It grants no endpoint, log, or account access.

## Bot semantics and cost

`verified_bot` requires Cloudflare's trusted verified-bot metadata. A bot claiming
an identity in its user agent is only `declared_bot`. Recognizable scripted clients
are `automation`; everything else is `unknown`, never asserted to be human.
Metadata availability depends on Cloudflare capabilities; absent metadata does
not prove a request is human. Requests blocked before reaching the Worker are
outside these summaries. The browser skips known crawler user agents; unknown
JS-capable automation can still contribute to reader analytics.

Counters represent requests, including assets and probes, not unique visitors.
One summary is emitted on the first request, then at most once per minute per
active isolate and surface. Isolate eviction or idle partial windows can lose
counts. Use these as approximate observed traffic, not exact totals. No raw user
agents, IP addresses, bodies, or query values are included in these summaries.

No additional database, queue, polling job, or idle timer is introduced in
Highsignal. Server clients are request-local, timer-disabled, have bounded queues,
a one-second delivery timeout, and no automatic retry. They flush through the
Worker lifetime or an awaited Next `after` callback. Endpoint and log batches use
separate ingest endpoints; this does not batch different HTTP requests together.
Browser delivery uses the bounded App Health tracker queue and heartbeat.

## September 12 production receipt

Runtime release: `6185c4db9648b2fbd1d5f8d667a4b0dc46ced355`, deployed to both
Workers at 100% after exact-revision CI and Docs passed. Deployment evidence is
recorded in [the release receipt](../evidence/app-health-2026-09-12.json).

- Browser: tracker 200, event batches 202, no browser errors during the probe.
- Real reading action: `signal.opened` acknowledged after opening a published signal.
- Server logs: controlled invalid Turnstile verification returned 403 and stored
  `history.blocked` at warn level. The actual verification gate remained intact.
- Bot visibility: `traffic.summary` rows contain declared bots on web and API.
  Verified-bot metadata was not observed in these canaries; it is not inferred.
- All three capability receipt timestamps are populated for Highsignal / production.
- Public viewer: signed-out page and aggregate API returned 200, with an active
  session and page-view totals. A separate temporary share returned 404 after
  revocation; the footer share was not revoked.
- Private key: environment-scoped, persisted in High Signal Infisical prod and
  provisioned on both Workers. No private value is stored in this repository.

The initial traffic includes controlled release verification. Leave the SDKs
running and review trends, failures, quotas and costs after several days; no
unattended review job has been created.

## Future activation or recovery checklist

The project, production environment, origin-scoped public key, and public share
already exist. Do not create a second project.

- Obtain authorization before any future key rotation or production release.
- Provision one production environment-scoped private ingest key on both
  Highsignal Workers as `APP_HEALTH_INGEST_KEY`, using the approved secret workflow.
  Never place it in source, public variables, command arguments, or plaintext files.
- Release the reviewed Highsignal web and API revisions. Keep the public key's
  allowed origins scoped to the production apex and www domains.
- Open the live site in a real browser. Verify a fresh page view, an intentional
  reading event, and live presence in Highsignal / production.
- Send a normal public API request and a declared-bot request. Confirm endpoint
  and `traffic.summary` receipts. At low traffic, a pending summary may require
  another request after a minute; its count is approximate.
- Open the footer's public viewer in a signed-out browser. Verify aggregates
  load and no logs or private credentials are exposed. Exercise revocation using
  a separate temporary share before revoking the attached share.
- Record the release SHA, receipt timestamps, and first live baseline in issue #178.
  After a few days, compare traffic trends, SDK delivery failures, ingestion
  quotas, and costs. No unattended observation job has been created.

## Local receipts

`pnpm quality` passes, including 36 suites and 391 API assertions. Three Playwright
integration checks cover SPA capture, private-route exclusion, crawler exclusion,
and analytics failures. The OpenNext Cloudflare web build passes. A tracker
fixture pins App Health commit `7354336`; it tests the integration offline and
must not be mistaken for proof of the currently deployed collector.

Browser command: `PLAYWRIGHT_HOST='[::1]' PLAYWRIGHT_PORT=4318 pnpm --filter @high-signal/web exec playwright test e2e/app-health.spec.ts`.
