import { isSourceDiscovery } from './source-discovery.mjs';
import { qualifyPublicSitemap } from './public-sitemap.mjs';
import { handlePublicDocs } from './public-docs-edge.mjs';
import { READER_BUILD } from './.open-next/reader-build.mjs';
import { serveReaderArtifact } from './reader-artifacts.mjs';
import { guardPublicRequest } from './abuse-guard.mjs';
import { handleAgentEdge, resolvePublicMarkdownTarget } from './agent-edge.mjs';
import { observeWebRequest } from './app-health.mjs';
import { createCacheSummary } from './cache-summary.mjs';
import { withTiming } from './timing.mjs';
import { isCacheableDocumentRequest } from './worker-cache-policy.mjs';

// Export the existing resources without loading Next's routing/rendering modules.
export { DOQueueHandler } from './.open-next/.build/durable-objects/queue.js';
export { DOShardedTagCache } from './.open-next/.build/durable-objects/sharded-tag-cache.js';
export { BucketCachePurge } from './.open-next/.build/durable-objects/bucket-cache-purge.js';

const summary = createCacheSummary();
function privatePath(url) {
  try {
    return new URL(decodeURIComponent(url.pathname), url.origin).pathname.startsWith('/_private/');
  } catch {
    return true;
  }
}
const serve = withTiming(async (request, env, ctx, state) => {
  const url = new URL(request.url);
  if (privatePath(url)) return new Response('Not found', { status: 404 });
  const guarded = guardPublicRequest(request);
  if (guarded) return guarded;
  if (url.hostname === 'www.highsignal.app') {
    url.hostname = 'highsignal.app';
    return Response.redirect(url.href, 308);
  }
  if (url.pathname === '/api/reader-build' && request.method === 'GET') {
    return Response.json(READER_BUILD, { headers: { 'Cache-Control': 'no-store' } });
  }
  const docs = await handlePublicDocs(request, env.ASSETS);
  if (docs) return docs;
  const agent = handleAgentEdge(request);
  if (agent) return agent;
  if (isSourceDiscovery(request) || resolvePublicMarkdownTarget(request)) {
    const { default: legacy } = await import('./legacy-worker.mjs');
    state.delegated = true;
    return legacy.fetch(request, env, ctx, { guardHandled: true });
  }
  const response = await serveReaderArtifact(request, env, ctx, READER_BUILD, caches.default);
  if (response) return response;
  // Legacy pages, RSC, protected history and unavailable/expired artifacts remain operable.
  const { default: legacy } = await import('./legacy-worker.mjs');
  state.delegated = true;
  return qualifyPublicSitemap(
    request,
    await legacy.fetch(request, env, ctx, { guardHandled: true })
  );
});

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const state = { delegated: false };
    let response;
    try {
      response = await serve(request, env, ctx, state);
      return response;
    } finally {
      if (!state.delegated) {
        const cacheSummary = summary(
          response,
          isCacheableDocumentRequest(request) || response?.headers.has('x-reader-renderer'),
          request,
          { release: env?.APP_HEALTH_RELEASE, readerSource: READER_BUILD.source }
        );
        observeWebRequest(request, response, startedAt, env, ctx, cacheSummary);
      }
    }
  },
};
