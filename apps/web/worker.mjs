// worker.mjs — wraps OpenNext; anon GET / serves the Astro landing from ASSETS.

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
  ['/sitemap.xml', 'public, max-age=300, s-maxage=3600'],
  ['/daily/range.json', 'public, max-age=60, s-maxage=300'],
]);
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
const CACHEABLE_PREFIXES = ['/case-studies', '/signals/types'];
function isCacheableDocumentPath(pathname) {
  if (!pathname) return false;
  if (CACHEABLE_EXACT.has(pathname)) return true;
  for (const prefix of CACHEABLE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function cacheControlForPath(pathname) {
  return DATA_CACHE_CONTROL.get(pathname) ?? CACHE_CONTROL;
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

    // Only Astro overlay at `/` is static; marketing pages use edge HTML cache.
    if (env.ASSETS && url.pathname === '/') {
      const assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status === 304) {
        const headers = new Headers(assetResp.headers);
        headers.set('Cache-Control', CACHE_CONTROL);
        headers.set('x-edge-cache', 'ASSET');
        return new Response(null, { status: 304, headers });
      }
      if (assetResp.ok && assetResp.body) {
        const acceptEnc = request.headers.get('accept-encoding') ?? '';
        const wantsGzip = acceptEnc.includes('gzip');
        const headers = new Headers(assetResp.headers);
        headers.set('Cache-Control', CACHE_CONTROL);
        headers.set('x-edge-cache', 'ASSET');

        if (wantsGzip && !headers.has('content-encoding')) {
          headers.set('content-encoding', 'gzip');
          headers.delete('content-length');
          const vary = headers.get('vary');
          headers.set('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
          return new Response(assetResp.body.pipeThrough(new CompressionStream('gzip')), {
            status: assetResp.status,
            statusText: assetResp.statusText,
            headers,
            encodeBody: 'manual',
          });
        }

        return new Response(assetResp.body, {
          status: assetResp.status,
          statusText: assetResp.statusText,
          headers,
        });
      }
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) {
      const hit = new Response(cached.body, cached);
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
    ctx.waitUntil(cache.put(request, cacheable.clone()));
    cacheable.headers.set('x-edge-cache', 'MISS');
    return cacheable;
  }),
};

export default worker;
