import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCacheSummary, cacheSummaryProps } from '../apps/web/cache-summary.mjs';
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const renderer = dataUrl(
  `export const DOQueueHandler=class {}; export const DOShardedTagCache=class {}; export const BucketCachePurge=class {}; export default {fetch: async request => { globalThis.__rendered++; return new Response('<html><main data-high-signal-public-cache="source-detail-v1">'+new URL(request.url).pathname+new URL(request.url).searchParams.get('date')+'</main></html>', {headers:{'content-type':'text/html','cache-control':'private, no-cache, no-store, max-age=0, must-revalidate'}}); }};`
);
let source = readFileSync(new URL('../apps/web/legacy-worker.mjs', import.meta.url), 'utf8');
source = source.replace(/from '([^']+)'/g, (_, path) => {
  const url =
    path === './.open-next/worker.js'
      ? renderer
      : path === './.open-next/reader-build.mjs'
        ? dataUrl('export const READER_BUILD={}')
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
  assert.equal(lines[0].unknown_hits, 1);
  assert.equal(lines[0].unknown_misses, 1);
  assert.equal(lines[0].unknown_bypasses, 1);
  assert.equal(lines[0].version, 'unknown');
  assert.equal(lines[0].version_source, 'unknown');
  assert.equal(lines[0].target_percent, 95);

  const release = 'a'.repeat(40);
  const windows = [];
  clock = 0;
  const cohortSummary = createCacheSummary(
    () => clock,
    (line) => windows.push(JSON.parse(line))
  );
  const hit = new Response(null, { headers: { 'x-edge-cache': 'HIT' } });
  const miss = new Response(null, { headers: { 'x-edge-cache': 'MISS' } });
  const browser = new Request('https://worker.test/data/private-source?secret=private-query', {
    headers: { 'user-agent': 'Mozilla/5.0 private-browser' },
  });
  const publisher = new Request(browser.url, {
    headers: { 'user-agent': 'HighSignal-reader-publisher/1 (private-marker)' },
  });
  const diagnostic = new Request('https://worker.test/data?validation=private-value');
  cohortSummary(hit, true, browser, { readerSource: release });
  cohortSummary(miss, true, publisher, { readerSource: release });
  clock = 60_000;
  const aggregate = cohortSummary(new Response(null), false, diagnostic, { readerSource: release });
  assert.deepEqual(aggregate, windows[0], 'the forwarded record matches the closed console window');
  assert.equal(aggregate.unknown_hits, 1);
  assert.equal(aggregate.declared_publisher_misses, 1);
  assert.equal(aggregate.declared_diagnostic_bypasses, 1);
  assert.equal(aggregate.hits, 1);
  assert.equal(aggregate.eligible, 2);
  assert.equal(aggregate.version, release);
  assert.equal(aggregate.version_source, 'reader_source');
  assert.equal(aggregate.eligible_hit_percent, 50);
  assert.doesNotMatch(JSON.stringify(aggregate), /private-|Mozilla|User-Agent|secret=/);
  const safe = cacheSummaryProps({ ...aggregate, raw_query: 'private-query' });
  assert.equal(safe.eligible_hit_percent, 50);
  assert.equal(safe.target_percent, 95);
  assert.equal(safe.scope, 'worker_executed');
  assert.doesNotMatch(JSON.stringify(safe), /private-query|raw_query/);
  assert.equal(cacheSummaryProps({ ...aggregate, hits: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(cacheSummaryProps({ ...aggregate, unknown_hits: -1 }), null);
  assert.equal(cacheSummaryProps({ ...aggregate, hits: 2 }), null);
  assert.equal(cacheSummaryProps(null), null);
  assert.equal(
    cacheSummaryProps({ ...aggregate, version_source: 'private-source' }).version,
    'unknown'
  );
  assert.equal(
    cacheSummaryProps({ ...aggregate, version: 'private?secret=value' }).version,
    'unknown'
  );

  clock = 0;
  const changes = [];
  const versioned = createCacheSummary(
    () => clock,
    (line) => changes.push(JSON.parse(line))
  );
  versioned(hit, true, browser, { release });
  clock = 1_000;
  const oldWindow = versioned(miss, true, browser, { release: 'b'.repeat(40) });
  assert.equal(oldWindow.version, release);
  assert.equal(oldWindow.hits, 1);
  assert.equal(oldWindow.misses, 0);
  clock = 61_000;
  const newWindow = versioned(hit, true, browser, { release: 'b'.repeat(40) });
  assert.equal(newWindow.version, 'b'.repeat(40));
  assert.equal(newWindow.hits, 1);
  assert.equal(newWindow.misses, 1);
  assert.equal(
    changes.reduce((sum, window) => sum + window.eligible, 0),
    3
  );
  assert.ok(changes.every((window) => cacheSummaryProps(window)));
  clock = 0; // Simulate the Worker module clock before the first request.
  const requestClock = createCacheSummary(
    () => clock,
    () => {}
  );
  clock = 5_000;
  assert.equal(requestClock(hit, true), undefined);
  clock = 65_000;
  const requestWindow = requestClock(hit, true);
  assert.equal(requestWindow.started_at, 5_000);
  assert.equal(requestWindow.ended_at, 65_000);
  assert.equal(requestWindow.hits, 2);
  console.log(
    `Public cache workload: ${hits} hits / ${hits + misses} requests (${(100 * hits) / (hits + misses)}%).`
  );
} finally {
  globalThis.caches = original;
  delete globalThis.__rendered;
}
