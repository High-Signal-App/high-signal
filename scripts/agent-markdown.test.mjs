#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  handleAgentEdge,
  handleRenderedMarkdown,
  htmlDocumentToMarkdown,
  resolvePublicMarkdownTarget,
} from '../apps/web/agent-edge.mjs';
import {
  PUBLIC_DYNAMIC_ROUTE_TEMPLATES,
  PUBLIC_STATIC_ROUTES,
  isPublicHtmlPath,
} from '../apps/web/public-route-registry.mjs';

const markdownRequest = (path, headers = {}) =>
  new Request(`https://highsignal.app${path}`, { headers });

assert.equal(PUBLIC_STATIC_ROUTES.length, 32, 'static public route count must be deliberate');
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

const missing = await handleRenderedMarkdown(markdownRequest('/signals/missing.md'), async () => {
  return new Response('not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
});
assert.equal(missing.status, 404, 'missing dynamic content must not become a fake Markdown 200');

const catalogResponse = handleAgentEdge(markdownRequest('/api/ai'));
assert.ok(catalogResponse);
const catalog = await catalogResponse.json();
assert.equal(catalog.surfaces.length, PUBLIC_STATIC_ROUTES.length);
assert.equal(catalog.templates.length, PUBLIC_DYNAMIC_ROUTE_TEMPLATES.length);
assert.ok(catalog.surfaces.every((surface) => surface.url && surface.md));
assert.equal(catalog.markdown.negotiation, true);
assert.match(catalog.auth.notes, /Review, admin, auth, personal, delivery/);

const staticCatalogResponse = handleAgentEdge(markdownRequest('/api-ai.json'));
assert.ok(staticCatalogResponse);
assert.deepEqual(await staticCatalogResponse.json(), catalog);

console.log(
  `Agent Markdown contract passed: ${catalog.surfaces.length} static surfaces, ${catalog.templates.length} dynamic templates.`
);
