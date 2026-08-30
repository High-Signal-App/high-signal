---
title: Public edge-cache verification
description: Verify that anonymous High Signal reads reuse Cloudflare cache without sharing operator or error responses.
---

# Public edge-cache verification

High Signal has guarded Cloudflare cache layers:

- `high-signal-web` uses `caches.default` for anonymous HTML, RSC, and agent
  representations in `apps/web/worker.mjs`.
- `high-signal-api` routes safe anonymous `GET` and `HEAD` requests through a cached
  `PublicApi` entrypoint before Worker execution. The default entrypoint remains
  an uncached gateway so private request variants cannot hit public cache entries.
- The API also retains its `caches.default` layer for successful anonymous
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
summary changes on ingestion cadence, not reader cadence. It uses one minute of
browser freshness and one hour of shared-cache freshness. Representative
samples are opt-in with `?samples=`; the Data page does not request them.

Cache is not the only cost boundary. `GET /data/sources` and
`GET /data/sources/:id` no longer aggregate the whole `events` table on a cache
miss: they read the per-source rollup that the `*/30` cron maintains
(`workers/api/src/lib/events-rollup.ts`, migration 0025). Stored-row counts,
observed watermarks, and future-dated counts are therefore **at most 30 minutes
behind `events`**. A `?date=` drill-in still queries `events` directly, because
the rollup carries no per-day breakdown. If the rollup table is empty — a fresh
database, or before the first cron tick after a deploy — both routes fall back
to the live aggregate and answer identically, just more expensively.

The cron skips the rebuild whenever it would produce the identical answer, and
forces one every six hours regardless, so an out-of-band `DELETE FROM events`
(the ingest runbook's escape hatch) self-heals within six hours rather than
leaving the rollup permanently wrong.

The public `/data` directory and source-detail HTML use one minute of browser
freshness and five minutes of shared-cache freshness. This outer Worker policy
must stay aligned with the pages' five-minute Next.js revalidation interval;
the generic 24-hour HTML policy is too stale for source-health status.

The Cache API prevents repeated D1 queries and upstream fetches after the first
request in a Cloudflare data center. The cached `PublicApi` entrypoint adds the
front-of-Worker layer, so a `CF-Cache-Status: HIT` response does not invoke the
application Worker. Cookie-bearing, authorized, admin, health, mutation, error,
and `Set-Cookie` responses stay outside that layer.

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

Expected API receipt after the front-of-Worker cache is released:

1. First successful request: `CF-Cache-Status: MISS` and an application cache
   receipt (`x-edge-cache: API-MISS` or `API-HIT`).
2. Second identical request: `CF-Cache-Status: HIT` with an `Age` header. The
   application receipt may still say `API-MISS` because that first response is
   what the outer cache stored.
3. Both: an explicit public `Cache-Control` header.
4. A changed query parameter: a new front-cache miss.
5. `/health`, `/admin/*`, a request with `Authorization` or `Cookie`, and any
   non-200 response: no shared-cache status and `private, no-store` unless the
   route already defines a stricter private policy.

For the web homepage, the equivalent receipt is `x-edge-cache: MISS` followed
by `x-edge-cache: HIT`. `Cf-Cache-Status` and `Age` may also appear, but the
application header is the deterministic contract for Cache API reads.

Do not purge the production cache merely to perform this check. A query variant
or the normal TTL is sufficient for a cold-cache verification.
