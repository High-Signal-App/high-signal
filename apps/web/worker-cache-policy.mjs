import { PUBLIC_CORPUS_POLICY_REVISION } from './public-corpus-policy.mjs';
import { isPublicHtmlPath, normalizePublicPath } from './public-route-registry.mjs';

const HTML_CACHE_CONTROL = 'public, max-age=300, s-maxage=86400';
const FRESH_HTML_CACHE_CONTROL = 'public, max-age=60, s-maxage=3600';
const DATA_HTML_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const ROOT_EDGE_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const ROOT_CLIENT_CACHE_CONTROL = 'private, no-cache';
const RSC_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600';
const FEED_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
const DATA_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';
const OG_IMAGE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';
const ROOT_CACHE_SCHEMA = 'daily-brief-v2';
const DATA_CACHE_SCHEMA = 'source-data-v2';
const TRACK_RECORD_CACHE_SCHEMA = 'track-record-v2';

// Public pages that intentionally do not advertise an AI-crawler Markdown
// representation. They still benefit from the same anonymous HTML/RSC cache.
const PUBLIC_HTML_ONLY_PATHS = new Set(['/case-studies/search', '/mentions']);

// Machine-readable public payloads. Feed readers and link expanders re-poll
// these far more often than browsers visit pages, and none of them read the
// query string — junk tracking params share the canonical cache entry.
// path -> [cache-control, required content-type substring]
const PUBLIC_DATA_CACHE_CONTROL = new Map([
  ['/sitemap.xml', ['public, max-age=300, s-maxage=3600', 'xml']],
  ['/robots.txt', ['public, max-age=3600, s-maxage=86400', 'text/plain']],
  ['/signals/rss', [FEED_CACHE_CONTROL, 'xml']],
  ['/signals/atom', [FEED_CACHE_CONTROL, 'xml']],
  ['/signals.json', [DATA_CACHE_CONTROL, 'json']],
  ['/entities.json', [DATA_CACHE_CONTROL, 'json']],
  ['/data/hit-rate.json', [DATA_CACHE_CONTROL, 'json']],
  ['/data/hit-rate.csv', [DATA_CACHE_CONTROL, 'csv']],
]);

// /entities/<id>/rss — per-entity feed, same cacheability as the main feeds.
const ENTITY_FEED_PATTERN = /^\/entities\/[^/]+\/rss$/;

// Query-keyed payloads — the query selects the response, so it stays in the
// cache key: OG images by ?title=, market snapshots by ?date=.
const QUERY_KEYED_DATA_PATHS = new Map([
  ['/api/og', [OG_IMAGE_CACHE_CONTROL, 'image/']],
  ['/markets.json', [DATA_CACHE_CONTROL, 'json']],
  ['/sectors/sectors.json', [DATA_CACHE_CONTROL, 'json']],
]);

// Requests carrying either an operator-session cookie or a verified-history
// grant must never be served from, or written to, the shared edge cache —
// both unlock personalized content that must not leak to anonymous traffic.
const AUTH_COOKIE_FRAGMENTS = ['CF_Authorization', 'high-signal-history'];

export function hasAuthCookie(request) {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  return AUTH_COOKIE_FRAGMENTS.some((fragment) => cookie.includes(fragment));
}

export function isRscRequest(request) {
  const url = new URL(request.url);
  return request.headers.get('rsc') === '1' && url.searchParams.has('_rsc');
}

export function isCacheableDocumentRequest(request) {
  if (request.method !== 'GET') return false;
  // Cloudflare Access accepts the JWT assertion header as well as the cookie.
  if (
    request.headers.has('authorization') ||
    request.headers.has('cf-access-jwt-assertion') ||
    hasAuthCookie(request)
  )
    return false;

  const url = new URL(request.url);
  const pathname = normalizePublicPath(url.pathname);
  if (!isPublicCachePath(pathname)) return false;

  // Anonymous HTML is cached only at its canonical, queryless URL. RSC
  // variants keep their complete URL and routing headers so Next.js cannot
  // receive or serve a payload for a different router state.
  if (isRscRequest(request)) {
    return (
      isPublicDocumentPath(pathname) && [...url.searchParams.keys()].every((key) => key === '_rsc')
    );
  }
  if (request.headers.get('rsc') === '1') return false;
  // Data payloads ignore junk query params (or are keyed by them, /api/og) —
  // tracking params cannot bypass the edge cache.
  if (isPublicDataPath(pathname)) return true;
  return url.search === '';
}

export function cacheKeyForRequest(request, buildId) {
  if (typeof buildId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(buildId)) {
    throw new Error('cache build namespace is required and must be a safe build ID');
  }
  const url = new URL(request.url);
  const pathname = normalizePublicPath(url.pathname);
  // Canonical data payloads do not vary by query string.
  if (!isRscRequest(request) && isCanonicalDataPath(pathname)) url.search = '';
  if (!isRscRequest(request) && pathname === '/') {
    url.searchParams.set('__hs_cache_schema', ROOT_CACHE_SCHEMA);
  } else if (!isRscRequest(request) && (pathname === '/data' || pathname.startsWith('/data/'))) {
    url.searchParams.set('__hs_cache_schema', DATA_CACHE_SCHEMA);
  } else if (pathname === '/track-record') {
    url.searchParams.set('__hs_cache_schema', TRACK_RECORD_CACHE_SCHEMA);
  }
  if (
    pathname === '/' ||
    pathname === '/sitemap.xml' ||
    ['/signals', '/entities', '/embed'].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    // Existing edge entries can outlive a release; policy changes must reach normal URLs.
    url.searchParams.set('__hs_presentation', PUBLIC_CORPUS_POLICY_REVISION);
  }
  // HTML and Flight payloads must come from the same Next build across deployments.
  url.searchParams.set('__hs_build', buildId);
  return url.href === request.url ? request : new Request(url, request);
}

export function cacheControlForRequest(request) {
  if (isRscRequest(request)) return RSC_CACHE_CONTROL;

  const pathname = normalizePublicPath(new URL(request.url).pathname);
  const dataPolicy = dataPolicyForPath(pathname);
  if (dataPolicy) return dataPolicy[0];
  if (pathname === '/') return ROOT_EDGE_CACHE_CONTROL;
  if (pathname === '/data' || pathname.startsWith('/data/')) return DATA_HTML_CACHE_CONTROL;
  if (
    pathname === '/brief/archive' ||
    pathname === '/signals' ||
    pathname.startsWith('/signals/') ||
    pathname === '/entities' ||
    pathname === '/markets' ||
    pathname.startsWith('/entities/') ||
    pathname.startsWith('/markets/')
  ) {
    return FRESH_HTML_CACHE_CONTROL;
  }
  return HTML_CACHE_CONTROL;
}

export function clientCacheControlForRequest(request) {
  const pathname = normalizePublicPath(new URL(request.url).pathname);
  if (pathname === '/' && !isRscRequest(request)) return ROOT_CLIENT_CACHE_CONTROL;
  return cacheControlForRequest(request);
}

export function isCacheableDocumentResponse(request, response) {
  if (response?.status !== 200 || response.headers.has('set-cookie')) return false;
  // Routes opt out per-response — e.g. the feeds' empty fallback when the API
  // is offline must never occupy the shared cache.
  const responseCacheControl = (response.headers.get('cache-control') ?? '').toLowerCase();
  if (responseCacheControl.includes('no-store') || responseCacheControl.includes('private'))
    return false;
  const pathname = normalizePublicPath(new URL(request.url).pathname);
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const dataPolicy = dataPolicyForPath(pathname);
  if (dataPolicy) return contentType.includes(dataPolicy[1]);
  return isRscRequest(request)
    ? contentType.includes('text/x-component')
    : contentType.includes('text/html');
}

export function edgeCacheStatus(request, result) {
  return isRscRequest(request) ? `RSC-${result}` : result;
}

function isPublicCachePath(pathname) {
  return isPublicDocumentPath(pathname) || isPublicDataPath(pathname);
}

function isPublicDataPath(pathname) {
  return (
    PUBLIC_DATA_CACHE_CONTROL.has(pathname) ||
    QUERY_KEYED_DATA_PATHS.has(pathname) ||
    ENTITY_FEED_PATTERN.test(pathname)
  );
}

function isCanonicalDataPath(pathname) {
  return PUBLIC_DATA_CACHE_CONTROL.has(pathname) || ENTITY_FEED_PATTERN.test(pathname);
}

function dataPolicyForPath(pathname) {
  return (
    PUBLIC_DATA_CACHE_CONTROL.get(pathname) ??
    QUERY_KEYED_DATA_PATHS.get(pathname) ??
    (ENTITY_FEED_PATTERN.test(pathname) ? [FEED_CACHE_CONTROL, 'xml'] : undefined)
  );
}

function isPublicDocumentPath(pathname) {
  return isPublicHtmlPath(pathname) || PUBLIC_HTML_ONLY_PATHS.has(pathname);
}
