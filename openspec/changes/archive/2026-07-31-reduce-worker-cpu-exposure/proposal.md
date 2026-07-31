## Why

`high-signal-web` consumed most of the Fleet account's included Worker CPU
during a crawler burst because requests reached the OpenNext Worker even when
the requested content or asset did not need request-time rendering. The
offending crawler is now blocked at Cloudflare, but the application should also
avoid Worker-first execution for verified static assets and should not
force-render a static page on every request.

## What Changes

- Keep authenticated, personalized, API, and genuinely request-dependent routes
  on the OpenNext Worker.
- Serve verified immutable Next.js and Astro build assets through Cloudflare's
  static asset binding before invoking the Worker.
- Prerender `/history`, whose current implementation contains no request data
  despite declaring `force-dynamic`.
- Add focused configuration and build checks that reject accidental removal of
  the static bypasses or a regression of `/history` to dynamic rendering.
- Keep broad HTML cache rules, route-wide caching, CPU-limit changes, and
  application deployment out of scope.

## Capabilities

### New Capabilities

- `bounded-worker-routing`: Defines which High Signal requests may bypass
  `high-signal-web` and which must continue through dynamic rendering.

### Modified Capabilities

None.

## Impact

- `apps/web/wrangler.toml`
- `apps/web/src/app/history/page.tsx`
- Focused web configuration tests
- Cloudflare static asset routing after the next application deployment

No dependency, API, schema, secret, database, or user-visible navigation change
is required. GitHub issue #57 tracks implementation and deployment remains a
separate operator decision.
