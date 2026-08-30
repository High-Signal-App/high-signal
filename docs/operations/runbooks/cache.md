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

### Paging the source drill-in

`GET /data/sources/:id` pages over a **total order on `(published_at, id)`**.
`published_at` alone is not unique — ingest writes a whole batch under one value,
and in production the newest 200 `markets` rows share a single one — so a `LIMIT`
over it is not a well-defined window and page boundaries inside a tie block can
repeat or drop rows. `?cursor=` is the supported way to walk the listing;
`?offset=` still works but re-reads everything it skips, and its cost grows with
depth while a cursor's does not.

The route picks one of two access paths, because `sourceMatch` can never use an
index on `source` (its `LIKE` arm is case-insensitive, so no BINARY index answers
it, and SQLite's OR-to-index optimization needs every arm to be usable):

- **seek** — resolve the family to concrete raw `source` values from the rollup,
  then seek `events_source_rollup_idx`. Chosen for families under
  `SEEK_PLAN_MAX_ROWS` rows, and for any family that spans a single source value.
- **scan** — walk `events_published_id_idx` newest-first and filter. Chosen for
  large families spread over many source values, where matches are dense enough
  that the first page is found within a few hundred rows.

Resolution reads the rollup **and** every source seen since the rollup's ingest
watermark, so a source value that first appeared after the last rebuild is still
found — the listing gains no staleness even though the totals beside it are up to
30 minutes old. That second query is pinned with `INDEXED BY
events_ingested_at_idx`; without the pin SQLite picks the source-leading index
and scans the table.

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
