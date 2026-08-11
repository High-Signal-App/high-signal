// worker.mjs — wraps OpenNext with guarded public HTML and agent-surface caching.

import openNext from './.open-next/worker.js';
import { guardPublicRequest } from './abuse-guard.mjs';
import { withTiming } from './timing.mjs';
import { handleAgentEdge, handleCachedRenderedMarkdown } from './agent-edge.mjs';

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js';

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const DATA_CACHE_CONTROL = new Map([
  ['/', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'],
  ['/brief/archive', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'],
  ['/sitemap.xml', 'public, max-age=300, s-maxage=3600'],
  ['/daily/range.json', 'public, max-age=60, s-maxage=300'],
]);
// Root previously cached the Astro landing under the unversioned URL. Keep a
// distinct cache key so this release cannot inherit that document at the edge.
const ROOT_CACHE_SCHEMA = 'daily-brief-v1';
const ROOT_CLIENT_CACHE_CONTROL = 'private, no-cache';
const PRIVATE_ASSET_PREFIX = '/_private/';
// Public marketing, discovery, and crawler surfaces. Authenticated requests
// bypass this cache below, and only explicit content types are stored.
const CACHEABLE_EXACT = new Set([
  '/',
  '/brief',
  '/track-record',
  '/methodology',
  '/about',
  '/case-studies',
  '/case-studies/search',
  '/teardowns',
  '/agent-eval',
  '/agent-eval/sample',
  '/domains',
  '/explore',
  '/history',
  '/convergence',
  '/lab',
  '/api-docs',
  '/signals',
  '/signals/today',
  '/signals/types',
  '/digest',
  '/markets',
  '/markets/history',
  '/communities',
  '/mentions',
  '/entities',
  '/sectors',
  '/opportunities',
  '/ideas',
  '/featured',
  '/privacy',
  '/terms',
  // Buyer-prompt and intelligence-guide surfaces (crawler-hot)
  '/compared',
  '/daily-intelligence-brief',
  '/market-intelligence-for-founders',
  '/startup-intelligence-platform',
  '/technology-trend-intelligence',
  '/sitemap.xml',
  '/daily/range.json',
]);
const CACHEABLE_PREFIXES = ['/brief', '/case-studies', '/signals/types'];
function isCacheableDocumentPath(pathname) {
  if (!pathname) return false;
  // This compatibility route must reach Next.js on every request so a cached
  // pre-cutover 200 response can never mask its permanent redirect.
  if (pathname === '/brief') return false;
  if (CACHEABLE_EXACT.has(pathname)) return true;
  for (const prefix of CACHEABLE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function cacheControlForPath(pathname) {
  return DATA_CACHE_CONTROL.get(pathname) ?? CACHE_CONTROL;
}

function clientCacheControlForPath(pathname) {
  return pathname === '/' ? ROOT_CLIENT_CACHE_CONTROL : cacheControlForPath(pathname);
}

function cacheKeyForRequest(request, pathname) {
  if (pathname !== '/') return request;
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set('__hs_cache_schema', ROOT_CACHE_SCHEMA);
  return new Request(cacheUrl, request);
}

function isCacheableContentType(pathname, contentType) {
  if (pathname === '/sitemap.xml') return contentType.includes('xml');
  if (pathname === '/daily/range.json') return contentType.includes('json');
  return contentType.includes('text/html');
}

const AUTH_COOKIE_FRAGMENTS = [
  '__session',
  '__client',
  '__clerk',
  'session_token',
  'session-token',
];

function hasAuthCookie(request) {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  return AUTH_COOKIE_FRAGMENTS.some((c) => cookie.includes(c));
}

const worker = {
  fetch: withTiming(async function fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(PRIVATE_ASSET_PREFIX)) {
      return new Response('Not found', { status: 404 });
    }
    // Agent / LLM indexing surfaces (fleet GEO standard)
    {
      const agent = handleAgentEdge(request);
      if (agent) return agent;
    }
    const guarded = guardPublicRequest(request);
    if (guarded) return guarded;

    const markdown = await handleCachedRenderedMarkdown(
      request,
      (htmlRequest) => openNext.fetch(htmlRequest, env, ctx),
      {
        cache: caches.default,
        cacheEnabled: !hasAuthCookie(request),
        waitUntil: (promise) => ctx.waitUntil(promise),
      }
    );
    if (markdown) return markdown;

    if (request.method !== 'GET') {
      return openNext.fetch(request, env, ctx);
    }
    if (!isCacheableDocumentPath(url.pathname)) {
      return openNext.fetch(request, env, ctx);
    }
    if (hasAuthCookie(request)) {
      return openNext.fetch(request, env, ctx);
    }

    const cache = caches.default;
    const cacheKey = cacheKeyForRequest(request, url.pathname);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('Cache-Control', clientCacheControlForPath(url.pathname));
      hit.headers.set('x-edge-cache', 'HIT');
      return hit;
    }

    const response = await openNext.fetch(request, env, ctx);
    const contentType = response.headers.get('content-type') ?? '';
    if (
      response.status !== 200 ||
      response.headers.has('set-cookie') ||
      !isCacheableContentType(url.pathname, contentType)
    ) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', cacheControlForPath(url.pathname));

    const cacheable = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
    cacheable.headers.set('Cache-Control', clientCacheControlForPath(url.pathname));
    cacheable.headers.set('x-edge-cache', 'MISS');
    return cacheable;
  }),
};

export default worker;
