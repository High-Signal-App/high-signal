import assert from 'node:assert/strict';
import { normalizeWebRoute, observeWebRequest } from '../apps/web/app-health.mjs';

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
  } finally {
    globalThis.fetch = original;
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
