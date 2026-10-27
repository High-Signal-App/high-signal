#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  agentDiscoveryLinkHeader,
  handleAgentEdge,
  handleCachedCrawlerMarkdown,
  handleCachedRenderedMarkdown,
  handleRenderedMarkdown,
  htmlDisallowsIndexing,
  resolvePublicMarkdownTarget,
} from '../apps/web/agent-edge.mjs';
import {
  PUBLIC_DYNAMIC_ROUTE_TEMPLATES,
  PUBLIC_STATIC_ROUTES,
  isPublicHtmlPath,
} from '../apps/web/public-route-registry.mjs';
import { publicSourceTree } from '../apps/web/src/lib/public-source-tree.ts';
const markdownRequest = (path, headers = {}) =>
  new Request(`https://highsignal.app${path}`, { headers });
const discoveryLinks = agentDiscoveryLinkHeader('https://highsignal.app');
for (const path of ['/llms.txt', '/llms-full.txt', '/ai.txt'])
  assert.ok(discoveryLinks.includes(`<https://highsignal.app${path}>; rel="describedby"`));
assert.match(discoveryLinks, /rel="ard"/);
assert.equal(PUBLIC_STATIC_ROUTES.length, 42);
assert.equal(PUBLIC_DYNAMIC_ROUTE_TEMPLATES.length, 11);
const shape = (path) => path.replace(/\[[^\]]+\]|\{[^}]+\}/g, '{}').replace(/\/$/, '');
const skipped = new Map([
  ['/brief', 'compatibility redirect'],
  ['/explore', 'compatibility redirect'],
  ['/review', 'operator review'],
  ['/backtest-workbench', 'operator execution'],
  ['/communities', 'explicit noindex'],
  ['/communities/{}/{}', 'explicit noindex'],
  ['/case-studies/search', 'explicit noindex'],
  ['/brief/archive', 'human-verified protected history'],
]);
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(resolve(dir, entry.name))
      : entry.name === 'page.tsx'
        ? [resolve(dir, entry.name)]
        : []
  );
const app = resolve('apps/web/src/app');
for (const file of walk(app)) {
  const path = '/' + relative(app, file).replace(/(?:^|\/)page\.tsx$/, '');
  const registered =
    PUBLIC_STATIC_ROUTES.some((route) => route.path === path) ||
    PUBLIC_DYNAMIC_ROUTE_TEMPLATES.some((route) => shape(route.html) === shape(path));
  assert.ok(
    registered || skipped.has(shape(path)),
    `Public page needs renderer or explicit exclusion: ${path}`
  );
  if (registered)
    assert.match(
      readFileSync(file, 'utf8'),
      /withAgentMetadata/,
      `${path} needs head discovery metadata`
    );
}
for (const route of PUBLIC_STATIC_ROUTES) {
  assert.ok(isPublicHtmlPath(route.path));
  assert.equal(
    resolvePublicMarkdownTarget(
      markdownRequest(route.path === '/' ? '/index.md' : route.path + '.md')
    )?.publicPath,
    route.path
  );
}
const source = (path) => ({
  path,
  url: `https://highsignal.app${path}`,
  title: 'Public evidence',
  description: 'A source-backed page.',
  markdown: `# Public evidence\n\nCanonical: https://highsignal.app${path}\n\nCurrent cited evidence.\n`,
});
let calls = 0;
const loader = async (request) => {
  calls++;
  assert.equal(request.headers.get('cookie'), null);
  assert.equal(request.headers.get('authorization'), null);
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.headers.get('accept'), 'application/json');
  return Response.json(source('/markets'));
};
for (const path of ['/markets.md', '/api/md/markets', '/markets']) {
  const response = await handleRenderedMarkdown(
    markdownRequest(path + '?ignored=1', {
      Accept: 'text/markdown;q=1, text/html;q=0.5',
      Cookie: 'private=not-forwarded',
      Authorization: 'Bearer not-forwarded',
    }),
    loader
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
  assert.equal(response.headers.get('content-location'), 'https://highsignal.app/markets');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
  assert.ok(Number(response.headers.get('x-markdown-tokens')) > 0);
  assert.match(await response.text(), /Current cited evidence/);
}
const head = await handleRenderedMarkdown(
  new Request('https://highsignal.app/markets.md', { method: 'HEAD' }),
  loader
);
assert.equal(head.status, 200);
assert.equal(await head.text(), '');
const options = await handleRenderedMarkdown(
  new Request('https://highsignal.app/api/md/markets', { method: 'OPTIONS' }),
  loader
);
assert.equal(options.status, 204);
for (const accept of [
  '',
  '*/*',
  'text/html',
  'text/markdown;q=0.5,text/html;q=0.5',
  'text/markdown;q=0.1,text/html;q=1',
])
  assert.equal(resolvePublicMarkdownTarget(markdownRequest('/markets', { Accept: accept })), null);
const beforeDenied = calls;
for (const path of [
  '/does-not-exist.md',
  '/review.md',
  '/admin/account.md',
  '/auth.md',
  '/api/md/admin',
  '/case-studies/search.md',
]) {
  const response = await handleRenderedMarkdown(markdownRequest(path), loader);
  assert.equal(response.status, 404, path);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
}
assert.equal(calls, beforeDenied, 'Private and unknown paths never invoke a source renderer');
for (const path of [
  '/api/ai.md',
  '/.well-known/agent-skills/high-signal-daily-brief/SKILL.md',
  '/_next/static/main.js',
])
  assert.equal(resolvePublicMarkdownTarget(markdownRequest(path)), null);
assert.equal(
  (
    await handleRenderedMarkdown(markdownRequest('/signals/missing.md'), async () =>
      Response.json({}, { status: 404 })
    )
  ).status,
  404
);
assert.equal(
  (
    await handleRenderedMarkdown(
      markdownRequest('/markets.md'),
      async () =>
        new Response('<html>not a source</html>', { headers: { 'Content-Type': 'text/html' } })
    )
  ).status,
  503
);
assert.equal(
  (
    await handleRenderedMarkdown(markdownRequest('/markets.md'), async () => {
      throw new Error('source unavailable');
    })
  ).status,
  503
);
const entries = new Map();
const pending = [];
const cache = {
  async match(request) {
    return entries.get(request.url)?.clone();
  },
  async put(request, response) {
    entries.set(request.url, response.clone());
  },
};
const cacheOptions = {
  cache,
  cacheBuildId: 'source-proof',
  waitUntil: (promise) => pending.push(promise),
};
const miss = await handleCachedRenderedMarkdown(
  markdownRequest('/markets.md'),
  loader,
  cacheOptions
);
assert.equal(miss.headers.get('x-edge-cache'), 'AGENT-MISS');
await Promise.all(pending);
const beforeHit = calls;
const hit = await handleCachedRenderedMarkdown(
  markdownRequest('/markets.md'),
  loader,
  cacheOptions
);
assert.equal(hit.headers.get('x-edge-cache'), 'AGENT-HIT');
assert.equal(calls, beforeHit);
assert.equal(await hit.text(), await miss.text());
const directHit = await handleCachedRenderedMarkdown(
  markdownRequest('/api/md/markets'),
  loader,
  cacheOptions
);
assert.equal(directHit.headers.get('x-edge-cache'), 'AGENT-HIT');
assert.equal(calls, beforeHit);
const history = await handleCachedRenderedMarkdown(
  markdownRequest('/signals/public.md'),
  async () => Response.json(source('/signals/public')),
  cacheOptions
);
assert.equal(history.headers.get('cache-control'), 'no-store');
assert.ok(![...entries.keys()].some((key) => key.includes('/signals/public')));
for (const agent of ['GPTBot', 'ClaudeBot', 'Bytespider', 'Lightpanda'])
  assert.equal(
    await handleCachedCrawlerMarkdown(markdownRequest('/markets', { 'User-Agent': agent })),
    null
  );
assert.equal(htmlDisallowsIndexing('<meta name="robots" content="noindex, follow">'), true);
const element = (type, props) => ({ type, props });
const rendered = await publicSourceTree(
  element('main', {
    children: [
      element('h1', { children: 'Evidence' }),
      element('p', { children: ['Public ', element('strong', { children: 'facts' }), '.'] }),
      element('section', { hidden: true, children: 'hidden content' }),
      element('pre', { children: element('code', { children: 'a\n\n\nb' }) }),
    ],
  }),
  { canonical: 'https://highsignal.app/markets' }
);
assert.match(rendered, /# Evidence/);
assert.match(rendered, /\*\*facts\*\*/);
assert.doesNotMatch(rendered, /hidden content/);
assert.match(rendered, /a\n\n\nb/);
await assert.rejects(
  publicSourceTree(element({}, {}), { canonical: 'https://highsignal.app/' }),
  /explicit source adapter/
);
await assert.rejects(
  publicSourceTree(element('div', { dangerouslySetInnerHTML: { __html: '<p>rendered</p>' } }), {
    canonical: 'https://highsignal.app/',
  }),
  /not serialized HTML/
);

const catalogResponse = handleAgentEdge(markdownRequest('/api/ai'));
assert.ok(catalogResponse);
const catalog = await catalogResponse.json();
assert.equal(catalog.surfaces.length, PUBLIC_STATIC_ROUTES.length);
assert.equal(catalog.templates.length, PUBLIC_DYNAMIC_ROUTE_TEMPLATES.length);
assert.ok(catalog.templates.every((template) => template.eligibility));
assert.ok(catalog.surfaces.every((surface) => surface.url && surface.md));
assert.equal(catalog.markdown.negotiation, true);
assert.deepEqual(catalog.mcp, {
  url: 'https://api.highsignal.app/mcp',
  serverCard: 'https://api.highsignal.app/mcp/server-card',
  transport: 'streamable-http',
  auth: 'none',
  tools: [
    'get_daily_brief',
    'get_signal',
    'get_daily_dump',
    'get_source_coverage',
    'search_signals',
    'browse_source',
    'get_track_record',
    'get_entity',
  ],
});
assert.equal(
  catalog.agentSkills.dailyBrief,
  'https://highsignal.app/.well-known/agent-skills/high-signal-daily-brief/SKILL.md'
);
assert.equal(catalog.ard, 'https://highsignal.app/.well-known/ard.json');

const agentModeResponse = handleAgentEdge(markdownRequest('/?mode=agent'));
assert.ok(agentModeResponse);
assert.equal(agentModeResponse.headers.get('content-location'), '/api/ai');
assert.deepEqual(await agentModeResponse.json(), catalog);

const skillPath = 'apps/web/public/.well-known/agent-skills/high-signal-daily-brief/SKILL.md';
const skillIndex = JSON.parse(
  readFileSync('apps/web/public/.well-known/agent-skills/index.json', 'utf8')
);
const skillDigest = `sha256:${createHash('sha256').update(readFileSync(skillPath)).digest('hex')}`;
assert.equal(
  skillIndex.skills[0].digest,
  skillDigest,
  'published skill digest must match SKILL.md'
);
assert.match(readFileSync(skillPath, 'utf8'), /The service is free and requires no reader account/);
assert.match(catalog.auth.notes, /Review, admin, delivery/);
assert.equal(
  catalog.dataResources.find((resource) => resource.id === 'daily-dump-json')?.url,
  'https://api.highsignal.app/data/daily'
);
assert.equal(
  catalog.dataResources.find((resource) => resource.id === 'high-signal-mcp')?.url,
  'https://api.highsignal.app/mcp'
);

const staticCatalogResponse = handleAgentEdge(markdownRequest('/api-ai.json'));
assert.ok(staticCatalogResponse);
assert.deepEqual(await staticCatalogResponse.json(), catalog);

const openapiResponse = handleAgentEdge(markdownRequest('/openapi.json'));
assert.ok(openapiResponse);
const openapi = await openapiResponse.json();
assert.equal(openapi.openapi, '3.1.0');
assert.ok(openapi.paths['/signals/{slug}']);
assert.ok(openapi.paths['/entities/{id}/{period}']);
assert.equal(openapi.paths['/entities/{id}/{id}'], undefined);
assert.deepEqual(openapi.paths['/data/daily'].get.servers, [{ url: 'https://api.highsignal.app' }]);
assert.equal(openapi.paths['/data/daily'].get.parameters[0].name, 'date');
assert.deepEqual(
  openapi.paths['/entities/{id}/{period}'].get.parameters.map((parameter) => parameter.name),
  ['id', 'period'],
  'OpenAPI dynamic paths must keep distinct, valid parameter names'
);

console.log(
  `Agent Markdown contract passed: ${catalog.surfaces.length} static surfaces, ${catalog.templates.length} dynamic templates.`
);
