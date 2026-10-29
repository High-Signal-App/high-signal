import assert from 'node:assert/strict';
import { handleSourceDiscovery } from '../apps/web/source-discovery.mjs';
const origin = 'https://highsignal.app';
const routes = Array.from({ length: 60 }, (_, index) => ({
  path: `/page-${index}`,
  url: `${origin}/page-${index}`,
  md: `${origin}/page-${index}.md`,
  title: `Page ${index}`,
  description: 'Public source text.',
}));
const assets = {
  fetch: async (request) => {
    assert.equal(new URL(request.url).pathname, '/api/md/_docs');
    return Response.json([]);
  },
};
let calls = 0;
const render = async (request) => {
  calls++;
  assert.equal(request.headers.get('cookie'), null);
  assert.equal(request.headers.get('authorization'), null);
  const url = new URL(request.url);
  if (url.pathname === '/api/public-markdown-catalog')
    return Response.json({
      routes,
      next: `${origin}/api/md/_catalog?cursor=next`,
      observedAt: '2026-10-27',
    });
  return Response.json({
    markdown: `# Source\n\nCanonical: ${origin}${url.pathname.replace('/api/public-markdown', '')}\n\n${'Evidence. '.repeat(1000)}`,
  });
};
const entries = new Map();
const cache = {
  match: async (key) => entries.get(key.url)?.clone(),
  put: async (key, response) => entries.set(key.url, response.clone()),
};
for (const path of ['/llms.txt', '/llms-full.txt', '/ai.txt', '/api/md/_catalog']) {
  const response = await handleSourceDiscovery(
    new Request(origin + path, {
      headers: { Cookie: 'private=not-forwarded', Authorization: 'Bearer not-forwarded' },
    }),
    render,
    { assets, cache }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  const body = await response.text();
  if (path === '/llms-full.txt') {
    assert.ok(body.length <= 500000);
    assert.ok((body.match(/<!-- source:/g) || []).length <= 50);
    assert.match(body, /initial catalog page/);
  }
  if (path === '/ai.txt') {
    assert.match(body, /training: allowed on public pages only/);
    assert.match(body, /initial-catalog-page-route-count: 60/);
  }
  if (path === '/api/md/_catalog')
    assert.equal(JSON.parse(body).next, origin + '/api/md/_catalog?cursor=next');
  const count = calls;
  const head = await handleSourceDiscovery(new Request(origin + path, { method: 'HEAD' }), render, {
    assets,
    cache,
  });
  assert.equal(await head.text(), '');
  assert.equal(calls, count, 'HEAD reuses generated source cache');
}
const failed = await handleSourceDiscovery(
  new Request(origin + '/llms.txt'),
  async () => {
    throw new Error('offline');
  },
  { assets }
);
assert.equal(failed.status, 503);
assert.equal(failed.headers.get('Cache-Control'), 'no-store');
console.log(
  'Public discovery: sanitized sources, paginated counts, bounded full export, cache and HEAD passed.'
);
