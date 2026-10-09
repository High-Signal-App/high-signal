import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCacheSummary } from '../apps/web/cache-summary.mjs';
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const renderer = dataUrl(
  `export const DOQueueHandler=class {}; export const DOShardedTagCache=class {}; export const BucketCachePurge=class {}; export default {fetch: async request => { globalThis.__rendered++; return new Response('<html><main data-high-signal-public-cache="source-detail-v1">'+new URL(request.url).pathname+new URL(request.url).searchParams.get('date')+'</main></html>', {headers:{'content-type':'text/html','cache-control':'private, no-cache, no-store, max-age=0, must-revalidate'}}); }};`
);
let source = readFileSync(new URL('../apps/web/worker.mjs', import.meta.url), 'utf8');
source = source.replace(/from '([^']+)'/g, (_, path) => {
  const url =
    path === './.open-next/worker.js'
      ? renderer
      : path === './.open-next/cache-build-id.mjs'
        ? dataUrl("export const CACHE_BUILD_ID='test-build'")
        : path === './app-health.mjs'
          ? dataUrl('export function observeWebRequest() {}')
          : new URL(`../apps/web/${path}`, import.meta.url).href;
  return `from '${url}'`;
});
const { default: worker } = await import(dataUrl(source));
const entries = new Map();
const original = globalThis.caches;
globalThis.__rendered = 0;
globalThis.caches = {
  default: {
    async match(key) {
      return entries.get(key.url)?.clone();
    },
    async put(key, response) {
      entries.set(key.url, response);
    },
  },
};
let hits = 0,
  misses = 0;
try {
  for (let i = 0; i < 1000; i++) {
    const index = i % 20;
    const request = new Request(
      `https://highsignal.app/data/source${index}?utm_source=campaign${i}&date=2026-10-${index % 2 ? '08' : '09'}`
    );
    const pending = [];
    const response = await worker.fetch(
      request,
      {},
      {
        waitUntil(p) {
          pending.push(p);
        },
      }
    );
    if (response.headers.get('x-edge-cache') === 'HIT') hits++;
    else misses++;
    assert.equal(
      await response.text(),
      `<html><main data-high-signal-public-cache="source-detail-v1">/data/source${index}2026-10-${index % 2 ? '08' : '09'}</main></html>`
    );
    await Promise.all(pending);
  }
  assert.equal(globalThis.__rendered, 20);
  assert.ok(
    hits / (hits + misses) >= 0.95,
    'representative repeated public-query workload must meet 95%'
  );
  const privateRequest = new Request('https://highsignal.app/data/source1?date=2026-10-08', {
    headers: { authorization: 'Bearer test' },
  });
  const response = await worker.fetch(privateRequest, {}, { waitUntil() {} });
  assert.equal(response.headers.get('x-edge-cache'), null, 'authenticated requests must bypass');
  const lines = [];
  let clock = 0;
  const summarize = createCacheSummary(
    () => clock,
    (line) => lines.push(JSON.parse(line))
  );
  summarize(new Response(null, { headers: { 'x-edge-cache': 'HIT' } }), true);
  summarize(new Response(null, { headers: { 'x-edge-cache': 'MISS' } }), true);
  clock = 60_000;
  summarize(new Response(null), false);
  assert.equal(lines[0].eligible_hit_percent, 50);
  assert.equal(lines[0].bypasses, 1);
  console.log(
    `Public cache workload: ${hits} hits / ${hits + misses} requests (${(100 * hits) / (hits + misses)}%).`
  );
} finally {
  globalThis.caches = original;
  delete globalThis.__rendered;
}
