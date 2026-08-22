import { isPublicHtmlPath, normalizePublicPath } from './public-route-registry.mjs';

const HTML_CACHE_CONTROL = 'public, max-age=300, s-maxage=86400';
const FRESH_HTML_CACHE_CONTROL = 'public, max-age=60, s-maxage=3600';
const ROOT_EDGE_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const ROOT_CLIENT_CACHE_CONTROL = 'private, no-cache';
const RSC_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600';
const ROOT_CACHE_SCHEMA = 'daily-brief-v2';

// Public pages that intentionally do not advertise an AI-crawler Markdown
// representation. They still benefit from the same anonymous HTML/RSC cache.
const PUBLIC_HTML_ONLY_PATHS = new Set([
  '/case-studies/search',
  '/history',
  '/mentions',
  '/signals/today',
]);

const PUBLIC_DATA_CACHE_CONTROL = new Map([
  ['/sitemap.xml', 'public, max-age=300, s-maxage=3600'],
  ['/daily/range.json', 'public, max-age=60, s-maxage=300'],
]);

// A request carrying one of these must never be served from, or written to,
// the shared edge cache. `CF_Authorization` is Cloudflare Access's operator
// session cookie. Clerk fragments remain so stale browser cookies fail safe.
const AUTH_COOKIE_FRAGMENTS = [
  'CF_Authorization',
  '__session',
  '__client',
  '__clerk',
  'session_token',
  'session-token',
];

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
  if (request.headers.has('authorization') || hasAuthCookie(request)) return false;

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
  return url.search === '' && request.headers.get('rsc') !== '1';
}

export function cacheKeyForRequest(request) {
  const url = new URL(request.url);
  if (normalizePublicPath(url.pathname) !== '/' || isRscRequest(request)) return request;

  url.searchParams.set('__hs_cache_schema', ROOT_CACHE_SCHEMA);
  return new Request(url, request);
}

export function cacheControlForRequest(request) {
  if (isRscRequest(request)) return RSC_CACHE_CONTROL;

  const pathname = normalizePublicPath(new URL(request.url).pathname);
  const dataCacheControl = PUBLIC_DATA_CACHE_CONTROL.get(pathname);
  if (dataCacheControl) return dataCacheControl;
  if (pathname === '/') return ROOT_EDGE_CACHE_CONTROL;
  if (
    pathname === '/brief/archive' ||
    pathname === '/signals' ||
    pathname === '/signals/today' ||
    pathname === '/entities' ||
    pathname === '/markets' ||
    pathname.startsWith('/feeds/') ||
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
  const pathname = normalizePublicPath(new URL(request.url).pathname);
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (pathname === '/sitemap.xml') return contentType.includes('xml');
  if (pathname === '/daily/range.json') return contentType.includes('json');
  return isRscRequest(request)
    ? contentType.includes('text/x-component')
    : contentType.includes('text/html');
}

export function edgeCacheStatus(request, result) {
  return isRscRequest(request) ? `RSC-${result}` : result;
}

function isPublicCachePath(pathname) {
  return (
    isPublicDocumentPath(pathname) ||
    pathname.startsWith('/feeds/') ||
    PUBLIC_DATA_CACHE_CONTROL.has(pathname)
  );
}

function isPublicDocumentPath(pathname) {
  return isPublicHtmlPath(pathname) || PUBLIC_HTML_ONLY_PATHS.has(pathname);
}
