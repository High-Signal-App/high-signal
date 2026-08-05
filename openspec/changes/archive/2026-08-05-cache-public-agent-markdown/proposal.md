# Cache public agent Markdown at the edge

## Why

High Signal's public Markdown routes are correct, but a deep agent crawl can
re-render hundreds of Next.js pages through OpenNext. Production evidence on
2026-08-05 showed 250/250 sampled routes readable, followed by transient
timeouts on 21 of 35 catalog surfaces at concurrency eight. Every reported
surface returned HTTP 200 when retried serially, while a conservative,
retry-aware full crawl was still running after 15 minutes.

The Worker currently generates every `.md` response before reaching its
existing document-cache path. The response advertises shared freshness, but it
is not explicitly stored in `caches.default`. Repeated crawlers therefore pay
the complete HTML-render and HTML-to-Markdown conversion cost.

## What changes

- Cache successful anonymous canonical `.md` responses in the Cloudflare Cache
  API for the response's existing one-hour shared TTL.
- Serve a cache hit before invoking OpenNext.
- Preserve the current Markdown body, route eligibility, response status, and
  content type.
- Keep authenticated, query-bearing, negotiated-HTML-path, HEAD, error, and
  noindex responses outside this cache.
- Add focused cache hit/miss/non-cacheable tests and rerun the full public
  corpus and production agent-readiness receipts.

## Non-goals

- No route, copy, sitemap, catalog, or eligibility changes.
- No weaker audit threshold, smaller route sample, or hidden timeout.
- No new dependency, Cloudflare configuration, or D1 change.

## Impact

The first request at a Cloudflare location still renders normally. Subsequent
agent requests for the same canonical Markdown URL avoid OpenNext work until
the existing shared TTL expires. HTML traffic and personalized responses are
unchanged.
