#!/usr/bin/env node

import assert from 'node:assert/strict';

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

for (const path of [
  '/',
  '/about',
  '/signals/a-published-signal',
  '/entities/openai',
  '/entities/openai/2026-08',
  '/markets/NVDA',
  '/case-studies/page/2',
  '/case-studies/search',
  '/history',
  '/mentions',
  '/signals/today',
  '/feeds/brief/weekly',
  '/sitemap.xml',
  '/daily/range.json',
]) {
  assert.equal(isCacheableDocumentRequest(request(path)), true, `${path} must be edge-cacheable`);
}

for (const denied of [
  request('/brief'),
  request('/review'),
  request('/about?preview=1'),
  request('/about', { method: 'POST' }),
  request('/about', { headers: { Authorization: 'Bearer private' } }),
  request('/about', { headers: { Cookie: 'CF_Authorization=access.jwt.token' } }),
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
assert.equal(isCacheableDocumentRequest(rsc), true, 'canonical anonymous RSC must be cacheable');
assert.equal(
  isCacheableDocumentRequest(request('/signals/today?_rsc=route-state', { headers: { RSC: '1' } })),
  true,
  'public HTML-only RSC routes must be cacheable'
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

const rootKey = cacheKeyForRequest(request('/'));
assert.equal(new URL(rootKey.url).searchParams.get('__hs_cache_schema'), 'daily-brief-v2');
assert.equal(cacheKeyForRequest(request('/about')).url, 'https://highsignal.app/about');

assert.equal(cacheControlForRequest(request('/')), 'public, max-age=60, s-maxage=300');
assert.equal(clientCacheControlForRequest(request('/')), 'private, no-cache');
assert.equal(cacheControlForRequest(request('/about')), 'public, max-age=300, s-maxage=86400');
assert.equal(cacheControlForRequest(request('/markets/NVDA')), 'public, max-age=60, s-maxage=3600');
assert.equal(cacheControlForRequest(rsc), 'public, max-age=0, s-maxage=3600');
assert.equal(cacheControlForRequest(request('/sitemap.xml')), 'public, max-age=300, s-maxage=3600');
assert.equal(
  cacheControlForRequest(request('/daily/range.json')),
  'public, max-age=60, s-maxage=300'
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
    request('/daily/range.json'),
    new Response('{}', { headers: { 'Content-Type': 'application/json' } })
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

console.log('Worker cache policy contract passed.');
