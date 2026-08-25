---
title: Public edge-cache verification
description: Verify that anonymous High Signal reads reuse Cloudflare cache without sharing operator or error responses.
---

# Public edge-cache verification

High Signal has two guarded Cloudflare cache layers:

- `high-signal-web` uses `caches.default` for anonymous HTML, RSC, and agent
  representations in `apps/web/worker.mjs`.
- `high-signal-api` uses `caches.default` for successful anonymous `GET`
  responses in `workers/api/src/public-cache.ts`.

Both layers bypass authenticated or cookie-bearing requests. The API also
bypasses `/admin`, `/health`, mutations, errors, and `Set-Cookie` responses.
Query strings remain part of the cache key, so date, region, product, and other
public variants cannot overwrite each other.

## TTL and cost boundary

The default public API contract is one minute of browser freshness and five
minutes of shared-cache freshness. Routes with an explicit public
`Cache-Control` header retain their route-specific TTL.

`GET /data/sources` is a deliberate exception: its catalog and stored-row
summary changes on ingestion cadence, not reader cadence, and the aggregation
touches the events store. It uses one minute of browser freshness and one hour
of shared-cache freshness. Representative samples are opt-in with `?samples=`;
the Data page does not request them.

The Cache API prevents repeated D1 queries and upstream fetches after the first
request in a Cloudflare data center. It is data-center local and does not stop
the Worker itself from being invoked. Cloudflare's front-of-Worker caching can
also avoid Worker execution, but enabling it changes the deployed Worker
configuration and must be handled as a separately approved release change.

## Local checks

```bash
pnpm --filter @high-signal/api exec vitest run src/__tests__/public-cache.test.ts
pnpm --filter @high-signal/api typecheck
```

The policy test proves `API-MISS` then `API-HIT`, query-key separation, and
private bypass behavior without requiring a Cloudflare account.

## Live verification

Run each request twice from the same machine after an authorized deployment:

```bash
curl -sS -D - -o /dev/null https://api.highsignal.app/brief/daily
curl -sS -D - -o /dev/null https://api.highsignal.app/brief/daily

curl -sS -D - -o /dev/null 'https://api.highsignal.app/data/daily?date=2026-08-24'
curl -sS -D - -o /dev/null 'https://api.highsignal.app/data/daily?date=2026-08-24'
```

Expected API receipt:

1. First successful request: `x-edge-cache: API-MISS`.
2. Second identical request: `x-edge-cache: API-HIT`.
3. Both: an explicit public `Cache-Control` header.
4. A changed query parameter: a new `API-MISS`.
5. `/health`, `/admin/*`, a request with `Authorization` or `Cookie`, and any
   non-200 response: no shared-cache status and `private, no-store` unless the
   route already defines a stricter private policy.

For the web homepage, the equivalent receipt is `x-edge-cache: MISS` followed
by `x-edge-cache: HIT`. `Cf-Cache-Status` and `Age` may also appear, but the
application header is the deterministic contract for Cache API reads.

Do not purge the production cache merely to perform this check. A query variant
or the normal TTL is sufficient for a cold-cache verification.
