// worker.mjs — wraps OpenNext with guarded public HTML and agent-surface caching.

import openNext from './.open-next/worker.js';
import { guardPublicRequest } from './abuse-guard.mjs';
import { withTiming } from './timing.mjs';
import {
  handleAgentEdge,
  handleCachedCrawlerMarkdown,
  handleCachedRenderedMarkdown,
  RATE_LIMIT_HEADERS,
  wantsMarkdown,
} from './agent-edge.mjs';
import {
  cacheControlForRequest,
  cacheKeyForRequest,
  clientCacheControlForRequest,
  edgeCacheStatus,
  hasAuthCookie,
  isCacheableDocumentRequest,
  isCacheableDocumentResponse,
} from './worker-cache-policy.mjs';
import { isPublicHtmlPath, normalizePublicPath } from './public-route-registry.mjs';

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js';

const PRIVATE_ASSET_PREFIX = '/_private/';

/**
 * Post-process OpenNext responses for agent-friendliness:
 * - Unknown /api/* paths get JSON error bodies instead of HTML 404s.
 * - 404 responses with Accept: text/markdown get a markdown body.
 * - 200 HTML responses for public pages with markdown alternates get Vary: Accept.
 */
function postProcessResponse(request, url, response) {
  const pathname = url.pathname;

  // JSON error for unknown /api/* paths
  if (pathname.startsWith('/api/') && response.status === 404) {
    return new Response(
      JSON.stringify({
        error: 'not_found',
        message: `No API endpoint exists at ${pathname}.`,
        path: pathname,
        docs: `${url.origin}/api/ai`,
      }) + '\n',
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...RATE_LIMIT_HEADERS,
        },
      }
    );
  }

  // Agent-friendly 404 with markdown body
  if (response.status === 404 && wantsMarkdown(request)) {
    return new Response(
      `# Not found\n\nThe page at \`${pathname}\` does not exist on High Signal.\n\n## Available surfaces\n\n- [Agent catalog](${url.origin}/api/ai)\n- [LLM index](${url.origin}/llms.txt)\n- [OpenAPI spec](${url.origin}/openapi.json)\n- [Sitemap](${url.origin}/sitemap.xml)\n`,
      {
        status: 404,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          Vary: 'Accept',
        },
      }
    );
  }

  // Add Vary: Accept for HTML pages that have markdown alternates
  const normalizedPath = normalizePublicPath(pathname);
  const contentType = response.headers.get('content-type') ?? '';
  if (
    response.status === 200 &&
    contentType.includes('text/html') &&
    isPublicHtmlPath(normalizedPath)
  ) {
    const headers = new Headers(response.headers);
    const existingVary = headers.get('Vary');
    if (existingVary) {
      if (!existingVary.toLowerCase().includes('accept')) {
        headers.set('Vary', `${existingVary}, Accept`);
      }
    } else {
      headers.set('Vary', 'Accept');
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
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

    const crawlerMarkdown = await handleCachedCrawlerMarkdown(
      request,
      (htmlRequest) => openNext.fetch(htmlRequest, env, ctx),
      {
        cache: caches.default,
        cacheEnabled: !request.headers.has('authorization') && !hasAuthCookie(request),
        waitUntil: (promise) => ctx.waitUntil(promise),
      }
    );
    if (crawlerMarkdown) return crawlerMarkdown;

    const markdown = await handleCachedRenderedMarkdown(
      request,
      (htmlRequest) => openNext.fetch(htmlRequest, env, ctx),
      {
        cache: caches.default,
        cacheEnabled: !request.headers.has('authorization') && !hasAuthCookie(request),
        waitUntil: (promise) => ctx.waitUntil(promise),
      }
    );
    if (markdown) return markdown;

    if (!isCacheableDocumentRequest(request)) {
      const response = await openNext.fetch(request, env, ctx);
      return postProcessResponse(request, url, response);
    }

    const cache = caches.default;
    const cacheKey = cacheKeyForRequest(request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('Cache-Control', clientCacheControlForRequest(request));
      hit.headers.set('x-edge-cache', edgeCacheStatus(request, 'HIT'));
      return hit;
    }

    const response = await openNext.fetch(request, env, ctx);
    if (!isCacheableDocumentResponse(request, response)) {
      return postProcessResponse(request, url, response);
    }

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', cacheControlForRequest(request));
    // Add Accept negotiation without replacing OpenNext's RSC routing Vary
    // headers. RSC payloads have their own URL-keyed cache entries.
    const normalizedPath = normalizePublicPath(url.pathname);
    const contentType = headers.get('content-type') ?? '';
    if (contentType.includes('text/html') && isPublicHtmlPath(normalizedPath)) {
      const existingVary = headers.get('Vary');
      if (existingVary) {
        if (!existingVary.toLowerCase().includes('accept')) {
          headers.set('Vary', `${existingVary}, Accept`);
        }
      } else {
        headers.set('Vary', 'Accept');
      }
    }

    const cacheable = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
    cacheable.headers.set('Cache-Control', clientCacheControlForRequest(request));
    cacheable.headers.set('x-edge-cache', edgeCacheStatus(request, 'MISS'));
    return cacheable;
  }),
};

export default worker;
