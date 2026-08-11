#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  handleAgentEdge,
  handleCachedRenderedMarkdown,
  handleRenderedMarkdown,
  htmlDocumentToMarkdown,
  htmlDisallowsIndexing,
  resolvePublicMarkdownTarget,
} from '../apps/web/agent-edge.mjs';
import {
  PUBLIC_DYNAMIC_ROUTE_TEMPLATES,
  PUBLIC_STATIC_ROUTES,
  isPublicHtmlPath,
} from '../apps/web/public-route-registry.mjs';

const markdownRequest = (path, headers = {}) =>
  new Request(`https://highsignal.app${path}`, { headers });

assert.equal(PUBLIC_STATIC_ROUTES.length, 36, 'static public route count must be deliberate');
assert.ok(
  !PUBLIC_STATIC_ROUTES.some((route) => route.path === '/brief'),
  'the /brief compatibility redirect must not compete with the canonical root in the agent catalog'
);
assert.equal(
  PUBLIC_DYNAMIC_ROUTE_TEMPLATES.length,
  7,
  'dynamic route templates must be deliberate'
);

for (const route of PUBLIC_STATIC_ROUTES) {
  assert.ok(isPublicHtmlPath(route.path), `${route.path} must be recognized as public HTML`);
  const markdownPath = route.path === '/' ? '/index.md' : `${route.path}.md`;
  if (route.path !== '/') {
    assert.equal(
      resolvePublicMarkdownTarget(markdownRequest(markdownPath))?.publicPath,
      route.path,
      `${markdownPath} must resolve to its canonical HTML route`
    );
  }
}

const allowedDynamic = [
  ['/brief/2026-07-30.md', '/brief/2026-07-30'],
  ['/signals/market-shift.md', '/signals/market-shift'],
  ['/signals/types/demand_shift.md', '/signals/types/demand_shift'],
  ['/entities/apple.md', '/entities/apple'],
  ['/entities/apple/2026-07.md', '/entities/apple/2026-07'],
  ['/case-studies/page/2.md', '/case-studies/page/2'],
  ['/case-studies/acme.md', '/case-studies/acme'],
];
for (const [requested, expected] of allowedDynamic) {
  assert.equal(resolvePublicMarkdownTarget(markdownRequest(requested))?.publicPath, expected);
}

for (const denied of [
  '/review.md',
  '/admin/delivery.md',
  '/personal.md',
  '/signals/rss.md',
  '/signals/atom.md',
  '/signals/today.md',
  '/entities/random.md',
  '/case-studies/search.md',
  '/api/ai.md',
]) {
  assert.equal(
    resolvePublicMarkdownTarget(markdownRequest(denied)),
    null,
    `${denied} must stay private or non-HTML`
  );
}

assert.equal(
  resolvePublicMarkdownTarget(
    markdownRequest('/markets', { Accept: 'text/markdown, text/html;q=0.5' })
  )?.publicPath,
  '/markets',
  'Accept negotiation must use the same public route boundary'
);
assert.equal(
  resolvePublicMarkdownTarget(markdownRequest('/markets', { Accept: 'text/html' })),
  null,
  'ordinary HTML requests must remain with the application'
);

const converted = htmlDocumentToMarkdown(
  `<!doctype html><html><body><nav>skip me</nav><main>
    <h1>Evidence &amp; calls</h1>
    <p>Two cited sources support <strong>this read</strong>.</p>
    <ul><li><a href="/signals/one">First signal</a></li><li>Second signal</li></ul>
    <script>privateData = true</script>
  </main></body></html>`,
  'https://highsignal.app/signals'
);
assert.match(converted, /^# Evidence & calls/m);
assert.match(converted, /\*\*this read\*\*/);
assert.match(converted, /\[First signal\]\(https:\/\/highsignal\.app\/signals\/one\)/);
assert.doesNotMatch(converted, /skip me|privateData/);
assert.match(converted.trim(), /Canonical HTML: https:\/\/highsignal\.app\/signals$/);

const rendered = await handleRenderedMarkdown(markdownRequest('/markets.md'), async (request) => {
  assert.equal(new URL(request.url).pathname, '/markets');
  assert.equal(request.headers.get('accept'), 'text/html');
  return new Response(
    '<html><body><main><h1>Markets</h1><p>Current cited market evidence.</p></main></body></html>',
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
});
assert.equal(rendered.status, 200);
assert.match(rendered.headers.get('content-type') ?? '', /text\/markdown/);
assert.match(await rendered.text(), /Current cited market evidence/);

const cacheEntries = new Map();
const cacheWrites = [];
const markdownCache = {
  async match(request) {
    const response = cacheEntries.get(request.url)?.clone();
    if (response) response.headers.set('Cache-Control', 'public, max-age=14400, s-maxage=3600');
    return response;
  },
  async put(request, response) {
    cacheEntries.set(request.url, response.clone());
  },
};
let cachedRenderCount = 0;
const renderCachedMarkets = async () => {
  cachedRenderCount += 1;
  return new Response(
    '<html><body><main><h1>Markets</h1><p>Cached cited market evidence.</p></main></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
};
const cacheOptions = {
  cache: markdownCache,
  waitUntil(promise) {
    cacheWrites.push(promise);
  },
};
const cacheMiss = await handleCachedRenderedMarkdown(
  markdownRequest('/markets.md'),
  renderCachedMarkets,
  cacheOptions
);
assert.equal(cacheMiss.headers.get('x-edge-cache'), 'AGENT-MISS');
assert.equal(cachedRenderCount, 1);
const missBody = await cacheMiss.text();
await Promise.all(cacheWrites);

const cacheHit = await handleCachedRenderedMarkdown(
  markdownRequest('/markets.md'),
  renderCachedMarkets,
  cacheOptions
);
assert.equal(cacheHit.headers.get('x-edge-cache'), 'AGENT-HIT');
assert.equal(
  cacheHit.headers.get('cache-control'),
  'public, max-age=300, s-maxage=3600',
  'cache hits must preserve the public agent TTL even when the edge mutates browser max-age'
);
assert.equal(cachedRenderCount, 1, 'cache hit must not invoke OpenNext');
assert.equal(await cacheHit.text(), missBody, 'cache hit must preserve the rendered Markdown body');

for (const request of [
  markdownRequest('/markets.md?view=compact'),
  new Request('https://highsignal.app/markets.md', { method: 'HEAD' }),
]) {
  await handleCachedRenderedMarkdown(request, renderCachedMarkets, cacheOptions);
}
await handleCachedRenderedMarkdown(markdownRequest('/markets.md'), renderCachedMarkets, {
  ...cacheOptions,
  cacheEnabled: false,
});
assert.equal(cachedRenderCount, 4, 'query, HEAD, and authenticated paths must bypass the cache');

let errorCacheWrites = 0;
const errorResponse = await handleCachedRenderedMarkdown(
  markdownRequest('/signals/missing.md'),
  async () =>
    new Response('not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  {
    cache: {
      async match() {
        return undefined;
      },
      async put() {
        errorCacheWrites += 1;
      },
    },
  }
);
assert.equal(errorResponse.status, 404);
assert.equal(errorCacheWrites, 0, 'error responses must not enter the public Markdown cache');

let personalizedCacheWrites = 0;
const personalizedResponse = await handleCachedRenderedMarkdown(
  markdownRequest('/markets.md'),
  async () =>
    new Response('# Personalized markets\n', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Set-Cookie': 'session=private',
      },
    }),
  {
    cache: {
      async match() {
        return undefined;
      },
      async put() {
        personalizedCacheWrites += 1;
      },
    },
  }
);
assert.equal(personalizedResponse.status, 200);
assert.equal(
  personalizedCacheWrites,
  0,
  'responses carrying Set-Cookie must not enter the public Markdown cache'
);

const missing = await handleRenderedMarkdown(markdownRequest('/signals/missing.md'), async () => {
  return new Response('not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
});
assert.equal(missing.status, 404, 'missing dynamic content must not become a fake Markdown 200');

assert.equal(
  htmlDisallowsIndexing(
    '<html><head><meta content="follow, noindex" name="robots"></head><body></body></html>'
  ),
  true,
  'robots attributes may appear in any order'
);
const withheld = await handleRenderedMarkdown(
  markdownRequest('/case-studies/page/2.md'),
  async () =>
    new Response(
      '<html><head><meta name="robots" content="noindex, follow"></head><body><main><h1>Page 2</h1></main></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
);
assert.equal(withheld.status, 404, 'noindex HTML must not receive an agent Markdown alternate');

const catalogResponse = handleAgentEdge(markdownRequest('/api/ai'));
assert.ok(catalogResponse);
const catalog = await catalogResponse.json();
assert.equal(catalog.surfaces.length, PUBLIC_STATIC_ROUTES.length);
assert.equal(catalog.templates.length, PUBLIC_DYNAMIC_ROUTE_TEMPLATES.length);
assert.ok(catalog.templates.every((template) => template.eligibility));
assert.ok(catalog.surfaces.every((surface) => surface.url && surface.md));
assert.equal(catalog.markdown.negotiation, true);
assert.match(catalog.auth.notes, /Review, admin, auth, personal, delivery/);

const staticCatalogResponse = handleAgentEdge(markdownRequest('/api-ai.json'));
assert.ok(staticCatalogResponse);
assert.deepEqual(await staticCatalogResponse.json(), catalog);

console.log(
  `Agent Markdown contract passed: ${catalog.surfaces.length} static surfaces, ${catalog.templates.length} dynamic templates.`
);
