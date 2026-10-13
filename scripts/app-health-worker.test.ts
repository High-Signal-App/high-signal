import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeWebRoute, observeWebRequest } from '../apps/web/app-health.mjs';
import { createCacheSummary } from '../apps/web/cache-summary.mjs';

const { MAX_LOG_PROPS } = createRequire(new URL('../apps/web/package.json', import.meta.url))(
  '@saas-maker/app-health'
);

async function main() {
  assert.equal(normalizeWebRoute('/signals/private-slug'), '/web/signals/:param');
  assert.equal(normalizeWebRoute('/privacy'), '/web/privacy');
  assert.equal(normalizeWebRoute('/unknown/private'), null);
  const original = globalThis.fetch;
  const sent: Array<{
    url: string;
    body: { events: Array<Record<string, unknown>>; logs: Array<Record<string, unknown>> };
  }> = [];
  const deliveries: Promise<unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 202 });
  };
  try {
    observeWebRequest(
      new Request('https://highsignal.app/signals/private-slug?secret=hidden', {
        headers: { 'user-agent': 'Googlebot/2.1' },
      }),
      new Response(null, { status: 429 }),
      Date.now() - 10,
      { APP_HEALTH_INGEST_KEY: 'test-key' },
      { waitUntil: (p: Promise<unknown>) => deliveries.push(p) }
    );
    assert.equal(deliveries.length, 1);
    await Promise.all(deliveries);
    const endpoint = sent.find((entry) => entry.url.endsWith('/v1/ingest'));
    const logs = sent.find((entry) => entry.url.endsWith('/v1/logs'));
    assert.equal(endpoint?.body.events.length, 1);
    assert.equal(endpoint?.body.events[0]?.route, '/web/signals/:param');
    assert.equal(endpoint?.body.events[0]?.status_code, 429);
    assert.equal(logs?.body.logs.length, 1);
    assert.equal(logs?.body.logs[0]?.event, 'traffic.summary');
    assert.deepEqual(logs?.body.logs[0]?.props, {
      verified_bot: 0,
      declared_bot: 1,
      automation: 0,
      unknown: 0,
      requests: 1,
      window_ms: 0,
      surface: 'web',
    });
    assert.doesNotMatch(JSON.stringify(sent), /private-slug|hidden|Googlebot/);

    sent.length = 0;
    deliveries.length = 0;
    const env = { APP_HEALTH_INGEST_KEY: 'test-key' };
    for (let i = 0; i < 200; i++) {
      observeWebRequest(
        new Request('https://highsignal.app/data'),
        new Response(null),
        Date.now(),
        env,
        { waitUntil: (p: Promise<unknown>) => deliveries.push(p) }
      );
    }
    await Promise.all(deliveries);
    const batches = sent.filter((entry) => entry.url.endsWith('/v1/ingest'));
    assert.equal(batches.length, 4, '200 requests must use four 50-event HTTP batches');
    assert.equal(batches.flatMap((entry) => entry.body.events).length, 200);

    sent.length = 0;
    deliveries.length = 0;
    for (let i = 0; i < 200; i++) {
      observeWebRequest(
        new Request('https://highsignal.app/data', {
          headers: { 'user-agent': 'Lightpanda/1.0' },
        }),
        new Response(null, {
          status: 429,
          headers: { 'x-high-signal-guard': 'rate-limit' },
        }),
        Date.now(),
        { APP_HEALTH_INGEST_KEY: 'test-key' },
        { waitUntil: (p: Promise<unknown>) => deliveries.push(p) }
      );
    }
    await Promise.all(deliveries);
    assert.equal(
      sent.filter((entry) => entry.url.endsWith('/v1/ingest')).length,
      0,
      'rejected crawler bursts must not create per-request endpoint ingestion'
    );
    assert.ok(deliveries.length <= 1, 'traffic summaries remain bounded');

    sent.length = 0;
    deliveries.length = 0;
    let clock = 0;
    const summarize = createCacheSummary(
      () => clock,
      () => {}
    );
    const fixtureRequest = new Request(
      'https://highsignal.app/unknown/private-value?secret=hidden'
    );
    summarize(new Response(null, { headers: { 'x-edge-cache': 'HIT' } }), true, fixtureRequest);
    clock = 60_000;
    const cache = summarize(new Response(null), false, fixtureRequest);
    observeWebRequest(
      fixtureRequest,
      new Response(null),
      Date.now(),
      env,
      { waitUntil: (p: Promise<unknown>) => deliveries.push(p) },
      cache
    );
    await Promise.all(deliveries);
    const cacheLogs = sent
      .filter((entry) => entry.url.endsWith('/v1/logs'))
      .flatMap((entry) => entry.body.logs)
      .filter((log) => log.event === 'web.cache.summary');
    assert.equal(
      cacheLogs.length,
      1,
      'closed cache window is delivered even on an unmeasured route'
    );
    assert.equal(cacheLogs[0].level, 'debug');
    assert.equal((cacheLogs[0].props as Record<string, unknown>).hits, 1);
    assert.equal((cacheLogs[0].props as Record<string, unknown>).version, 'unknown');
    assert.ok(
      Object.keys(cacheLogs[0].props as Record<string, unknown>).length <= MAX_LOG_PROPS,
      'aggregate fields fit the installed SDK schema'
    );
    assert.doesNotMatch(JSON.stringify(sent), /private-value|hidden|secret=/);
    assert.equal(deliveries.length, 1, 'cache evidence reuses the request-owned buffered flush');
    sent.length = 0;
    deliveries.length = 0;
    observeWebRequest(
      fixtureRequest,
      new Response(null),
      Date.now(),
      {},
      { waitUntil: (p: Promise<unknown>) => deliveries.push(p) },
      cache
    );
    assert.equal(deliveries.length, 0, 'missing configured delivery remains fail-open');
    assert.equal(sent.length, 0);
  } finally {
    globalThis.fetch = original;
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
