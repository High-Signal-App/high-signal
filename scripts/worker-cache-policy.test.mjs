#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  cacheControlForRequest,
  cacheKeyForRequest,
  clientCacheControlForRequest,
  edgeCacheStatus,
  hasAuthCookie,
  isCacheableDocumentRequest,
  isCacheableDocumentResponse,
  isRscRequest,
} from '../apps/web/worker-cache-policy.mjs';

const request = (path, init = {}) => new Request(`https://highsignal.app${path}`, init);
const BUILD_A = 'build-a';
const BUILD_B = 'build-b';

const apiWrangler = readFileSync(new URL('../workers/api/wrangler.toml', import.meta.url), 'utf8');
assert.match(apiWrangler, /\[cache\]\s+enabled = false/);
assert.match(apiWrangler, /\[exports\.PublicApi\.cache\]\s+enabled = true/);

for (const path of [
  '/',
  '/about',
  '/entities/openai',
  '/entities/openai/2026-08',
  '/markets/NVDA',
  '/data',
  '/data/nvd',
  '/case-studies/page/2',
  '/case-studies/search',
  '/mentions',
  '/sitemap.xml',
]) {
  assert.equal(isCacheableDocumentRequest(request(path)), true, `${path} must be edge-cacheable`);
}
assert.equal(
  isCacheableDocumentRequest(request('/signals')),
  true,
  'the signals index remains edge-cacheable'
);
assert.equal(
  isCacheableDocumentRequest(request('/signals/types')),
  true,
  'the signal types index remains edge-cacheable'
);
assert.equal(
  isCacheableDocumentRequest(request('/signals/a-published-signal')),
  true,
  'anonymous signal detail HTML is edge-cacheable (grant holders bypass below)'
);

for (const path of [
  '/signals/rss',
  '/signals/atom',
  '/entities/openai/rss',
  '/signals.json',
  '/entities.json',
  '/markets.json',
  '/sectors/sectors.json',
  '/data/hit-rate.json',
  '/data/hit-rate.csv',
  '/robots.txt',
  '/api/og?title=Test',
]) {
  assert.equal(
    isCacheableDocumentRequest(request(path)),
    true,
    `${path} must be edge-cacheable`
  );
}

// Junk tracking params must not defeat the feed/JSON cache — canonical data
// payloads ignore their query string.
assert.equal(
  isCacheableDocumentRequest(request('/signals/rss?utm_source=bot&x=1')),
  true,
  'feeds stay cacheable under junk query params'
);
const feedKey = cacheKeyForRequest(request('/signals/rss?utm_source=bot&x=1'), BUILD_A);
assert.equal(feedKey.url.includes('utm_source'), false, 'junk params are stripped');
assert.equal(
  new URL(feedKey.url).searchParams.get('__hs_build'),
  BUILD_A,
  'junk params collapse into the canonical feed cache entry'
);
// Query-keyed payloads keep their query: /api/og varies by ?title=.
const ogA = cacheKeyForRequest(request('/api/og?title=Alpha'), BUILD_A).url;
const ogB = cacheKeyForRequest(request('/api/og?title=Beta'), BUILD_A).url;
assert.notEqual(ogA, ogB, 'OG images must be keyed by their title param');
assert.equal(
  new URL(ogA).searchParams.get('title'),
  'Alpha',
  'the title param stays in the cache key'
);

for (const denied of [
  request('/brief'),
  request('/review'),
  request('/about?preview=1'),
  request('/about', { method: 'POST' }),
  request('/about', { headers: { Authorization: 'Bearer private' } }),
  request('/about', { headers: { Cookie: 'CF_Authorization=access.jwt.token' } }),
  request('/signals/a-published-signal', {
    headers: { Cookie: 'high-signal-history=grant.token' },
  }),
  request('/track-record', { headers: { 'cf-access-jwt-assertion': 'access.jwt' } }),
]) {
  assert.equal(isCacheableDocumentRequest(denied), false, `${denied.url} must bypass the cache`);
}

// The operator session cookie must bypass the shared edge cache.
assert.equal(
  hasAuthCookie(request('/about', { headers: { Cookie: 'CF_Authorization=access.jwt.token' } })),
  true
);
assert.equal(hasAuthCookie(request('/about', { headers: { Cookie: 'theme=dark' } })), false);

const rsc = request('/signals/a-published-signal?_rsc=route-state', {
  headers: { RSC: '1', 'Next-Router-State-Tree': 'state' },
});
assert.equal(isRscRequest(rsc), true);
assert.equal(
  isCacheableDocumentRequest(rsc),
  true,
  'anonymous signal detail RSC is edge-cacheable'
);
assert.equal(
  isCacheableDocumentRequest(
    request('/signals/a-published-signal?_rsc=route-state&preview=1', { headers: { RSC: '1' } })
  ),
  false,
  'RSC requests with unrelated query state must bypass the cache'
);
assert.equal(
  isCacheableDocumentRequest(request('/signals/a-published-signal?_rsc=route-state')),
  false,
  'an _rsc query without the RSC header must not be mistaken for an RSC request'
);

const rootKey = cacheKeyForRequest(request('/'), BUILD_A);
assert.equal(new URL(rootKey.url).searchParams.get('__hs_cache_schema'), 'daily-brief-v2');
const dataKey = cacheKeyForRequest(request('/data'), BUILD_A);
assert.equal(new URL(dataKey.url).searchParams.get('__hs_cache_schema'), 'source-data-v2');
const dataSourceKey = cacheKeyForRequest(request('/data/nvd'), BUILD_A);
assert.equal(new URL(dataSourceKey.url).searchParams.get('__hs_cache_schema'), 'source-data-v2');
assert.equal(
  new URL(cacheKeyForRequest(request('/about'), BUILD_A).url).searchParams.get('__hs_build'),
  BUILD_A
);

assert.equal(cacheControlForRequest(request('/')), 'public, max-age=60, s-maxage=300');
assert.equal(clientCacheControlForRequest(request('/')), 'private, no-cache');
assert.equal(cacheControlForRequest(request('/about')), 'public, max-age=300, s-maxage=86400');
assert.equal(cacheControlForRequest(request('/markets/NVDA')), 'public, max-age=60, s-maxage=3600');
assert.equal(cacheControlForRequest(request('/data')), 'public, max-age=60, s-maxage=300');
assert.equal(cacheControlForRequest(request('/data/nvd')), 'public, max-age=60, s-maxage=300');
assert.equal(cacheControlForRequest(rsc), 'public, max-age=0, s-maxage=3600');
assert.equal(cacheControlForRequest(request('/sitemap.xml')), 'public, max-age=300, s-maxage=3600');
assert.equal(
  cacheControlForRequest(request('/signals/a-published-signal')),
  'public, max-age=60, s-maxage=3600'
);
assert.equal(cacheControlForRequest(request('/signals/rss')), 'public, max-age=300, s-maxage=300');
assert.equal(
  cacheControlForRequest(request('/entities/openai/rss')),
  'public, max-age=300, s-maxage=300'
);
assert.equal(cacheControlForRequest(request('/api/og?title=x')), 'public, max-age=86400, s-maxage=86400');

for (const [path, type] of [
  ['/signals/rss', 'application/rss+xml'],
  ['/signals/atom', 'application/atom+xml'],
  ['/entities/openai/rss', 'application/rss+xml'],
  ['/signals.json', 'application/json'],
  ['/data/hit-rate.csv', 'text/csv'],
  ['/robots.txt', 'text/plain'],
  ['/api/og?title=x', 'image/png'],
]) {
  assert.equal(
    isCacheableDocumentResponse(
      request(path),
      new Response('ok', { headers: { 'Content-Type': `${type}; charset=utf-8` } })
    ),
    true,
    `${path} must accept ${type} responses`
  );
}
assert.equal(
  isCacheableDocumentResponse(
    request('/signals/rss'),
    new Response('<h1>oops</h1>', { headers: { 'Content-Type': 'text/html' } })
  ),
  false,
  'a feed path must not cache an HTML error body'
);

assert.equal(
  isCacheableDocumentResponse(
    request('/about'),
    new Response('<h1>About</h1>', { headers: { 'Content-Type': 'text/html' } })
  ),
  true
);
assert.equal(
  isCacheableDocumentResponse(
    rsc,
    new Response('1:["route"]', { headers: { 'Content-Type': 'text/x-component' } })
  ),
  true
);
assert.equal(
  isCacheableDocumentResponse(
    request('/sitemap.xml'),
    new Response('<urlset />', { headers: { 'Content-Type': 'application/xml' } })
  ),
  true
);
assert.equal(
  isCacheableDocumentResponse(
    request('/about'),
    new Response('<h1>Private</h1>', {
      headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=private' },
    })
  ),
  false,
  'personalized responses must never enter the shared cache'
);
assert.equal(edgeCacheStatus(rsc, 'HIT'), 'RSC-HIT');
assert.equal(edgeCacheStatus(request('/about'), 'MISS'), 'MISS');

for (const path of [
  '/',
  '/signals',
  '/signals/example',
  '/signals/types/review',
  '/entities/OPENAI',
  '/embed/example',
  '/sitemap.xml',
]) {
  const key = cacheKeyForRequest(request(path), BUILD_A);
  assert.equal(new URL(key.url).searchParams.get('__hs_presentation'), '2026-09-07.1');
  assert.notEqual(key.url, request(path).url, 'old policy cache entries must not be reused');
}
const rscKey = cacheKeyForRequest(rsc, BUILD_A);
assert.equal(new URL(rscKey.url).searchParams.get('_rsc'), 'route-state');
assert.equal(new URL(rscKey.url).searchParams.get('__hs_presentation'), '2026-09-07.1');
assert.equal(rscKey.headers.get('Next-Router-State-Tree'), 'state');
assert.equal(rscKey.headers.get('RSC'), '1');
assert.notEqual(
  rscKey.url,
  cacheKeyForRequest(request('/signals/a-published-signal'), BUILD_A).url
);

assert.equal(
  new URL(cacheKeyForRequest(request('/track-record'), BUILD_A).url).searchParams.get(
    '__hs_cache_schema'
  ),
  'track-record-v2'
);

const htmlA = cacheKeyForRequest(request('/signals'), BUILD_A).url;
const htmlB = cacheKeyForRequest(request('/signals'), BUILD_B).url;
assert.notEqual(htmlA, htmlB, 'HTML cache entries must be isolated per build');
const rscA = cacheKeyForRequest(rsc, BUILD_A).url;
const rscB = cacheKeyForRequest(rsc, BUILD_B).url;
assert.notEqual(rscA, rscB, 'RSC cache entries must be isolated per build');

for (const invalidBuildId of [undefined, null, '', 'a/b', 'a b', 'a'.repeat(129), 123]) {
  assert.throws(() => cacheKeyForRequest(request('/signals'), invalidBuildId), /safe build ID/);
}

const generator = fileURLToPath(
  new URL('../apps/web/scripts/write-cache-build-id.mjs', import.meta.url)
);
for (const buildId of ['fixture-build-1\n', undefined, '', 'invalid/build']) {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'high-signal-cache-build-'));
  try {
    const fixtureAssets = resolve(fixtureRoot, '.open-next/assets');
    const generatedPath = resolve(fixtureRoot, '.open-next/cache-build-id.mjs');
    mkdirSync(fixtureAssets, { recursive: true });
    if (buildId !== undefined) writeFileSync(resolve(fixtureAssets, 'BUILD_ID'), buildId);
    const generated = spawnSync(process.execPath, [generator], {
      env: { ...process.env, CACHE_BUILD_WEB_ROOT: fixtureRoot },
      encoding: 'utf8',
    });
    if (buildId === 'fixture-build-1\n') {
      assert.equal(generated.status, 0, generated.stderr);
      const module = await import(pathToFileURL(generatedPath).href);
      assert.equal(module.CACHE_BUILD_ID, 'fixture-build-1');
    } else {
      assert.notEqual(generated.status, 0, 'missing or invalid BUILD_ID must stop the build');
      assert.equal(existsSync(generatedPath), false, 'never emit a shared fallback namespace');
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

console.log('Worker cache policy contract passed.');
