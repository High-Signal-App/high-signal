import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const renderer = dataUrl(`
  export const DOQueueHandler = class {};
  export const DOShardedTagCache = class {};
  export const BucketCachePurge = class {};
  export default { fetch: async () => {
    globalThis.__briefRenders++;
    const value = globalThis.__briefFixture;
    return new Response(value.html, {
      status: value.status ?? 200,
      headers: {
        'content-type': 'text/html',
        'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
        ...value.headers,
      },
    });
  }};
`);
let source = readFileSync(new URL('../apps/web/legacy-worker.mjs', import.meta.url), 'utf8');
source = source.replace(/from '([^']+)'/g, (_, path) => {
  const url =
    path === './.open-next/worker.js'
      ? renderer
      : path === './.open-next/reader-build.mjs'
        ? dataUrl('export const READER_BUILD = {}')
        : path === './.open-next/cache-build-id.mjs'
          ? dataUrl("export const CACHE_BUILD_ID = 'fallback-test-build'")
          : path === './app-health.mjs'
            ? dataUrl('export function observeWebRequest() {}')
            : new URL(`../apps/web/${path}`, import.meta.url).href;
  return `from '${url}'`;
});
const { default: worker } = await import(dataUrl(source));

test('the legacy worker shares only a qualified current public fallback', async () => {
  const previous = { cache: globalThis.caches, now: Date.now };
  let now = Date.parse('2026-10-01T18:30:00Z');
  Date.now = () => now;
  const entries = new Map();
  globalThis.caches = {
    default: {
      async match(key) {
        return entries.get(key.url)?.clone();
      },
      async put(key, response) {
        entries.set(key.url, response.clone());
      },
    },
  };
  const html = (day, text = 'Fresh public edition') =>
    `<main>${text}</main><span hidden="" data-high-signal-public-cache="current-brief-v1" data-edition-date="${day}" data-region="global"></span>`;
  const request = (path = '/', init = {}) => new Request(`https://highsignal.app${path}`, init);
  const fetch = async (input) => {
    const pending = [];
    const response = await worker.fetch(input, {}, { waitUntil: (work) => pending.push(work) });
    const body = await response.text();
    await Promise.all(pending);
    return { response, body };
  };
  try {
    globalThis.__briefRenders = 0;
    globalThis.__briefFixture = { html: html('2026-10-02') };
    const first = await fetch(request());
    assert.equal(first.response.headers.get('x-edge-cache'), 'MISS');
    assert.equal(first.response.headers.get('cache-control'), 'private, no-cache');
    assert.equal(first.body, html('2026-10-02'));
    assert.equal(entries.size, 1);
    assert.equal(
      [...entries.values()][0].headers.get('cache-control'),
      'public, max-age=60, s-maxage=300'
    );
    const firstKey = [...entries.keys()][0];
    assert.equal(new URL(firstKey).searchParams.get('__hs_edition_day'), '2026-10-02');
    const second = await fetch(request('/?utm_source=diagnostic'));
    assert.equal(second.response.headers.get('x-edge-cache'), 'HIT');
    assert.equal(second.body, first.body);
    assert.equal(globalThis.__briefRenders, 1);

    entries.clear();
    globalThis.__briefFixture = { html: html('2026-10-02', 'Changed public edition') };
    const refreshed = await fetch(request());
    assert.equal(refreshed.response.headers.get('x-edge-cache'), 'MISS');
    assert.equal(refreshed.body, html('2026-10-02', 'Changed public edition'));
    assert.equal((await fetch(request())).response.headers.get('x-edge-cache'), 'HIT');

    now = Date.parse('2026-10-02T18:30:00Z');
    const stale = await fetch(request());
    assert.equal(stale.response.headers.get('x-edge-cache'), null);
    globalThis.__briefFixture = { html: html('2026-10-03') };
    const rollover = await fetch(request());
    assert.equal(rollover.response.headers.get('x-edge-cache'), 'MISS');
    assert.equal(rollover.body, html('2026-10-03'));
    assert.equal(entries.size, 2);
    assert.notEqual([...entries.keys()].at(-1), firstKey);

    for (const [input, fixture] of [
      [request(), { html: '<main>Pending or unavailable edition</main>' }],
      [request(), { html: html('2026-10-02') }],
      [request(), { html: html('2026-10-04') }],
      [request(), { html: html('2026-10-03').replace('global', 'europe') }],
      [request(), { html: html('2026-10-03').replaceAll('<', '&lt;') }],
      [request(), { html: ' '.repeat(262_144) + html('2026-10-03') }],
      [request(), { html: html('2026-10-03'), headers: { 'cache-control': 'private, no-store' } }],
      [request(), { html: html('2026-10-03'), headers: { 'set-cookie': 'session=fixture' } }],
      [request(), { html: html('2026-10-03'), status: 503 }],
      [request('/?preview=1'), { html: html('2026-10-03') }],
      [request('/?day=yesterday'), { html: html('2026-10-03') }],
      [
        request('/', { headers: { authorization: 'Bearer fixture' } }),
        { html: html('2026-10-03') },
      ],
      [
        request('/', { headers: { cookie: 'high-signal-history=fixture' } }),
        { html: html('2026-10-03') },
      ],
      [
        request('/', { headers: { cookie: 'CF_Authorization=fixture' } }),
        { html: html('2026-10-03') },
      ],
      [
        request('/', { headers: { 'cf-access-jwt-assertion': 'fixture' } }),
        { html: html('2026-10-03') },
      ],
      [request('/?_rsc=state', { headers: { rsc: '1' } }), { html: html('2026-10-03') }],
    ]) {
      entries.clear();
      globalThis.__briefFixture = fixture;
      const result = await fetch(input);
      assert.equal(result.response.headers.get('x-edge-cache'), null, input.url);
      assert.equal(entries.size, 0, input.url);
    }
  } finally {
    globalThis.caches = previous.cache;
    Date.now = previous.now;
    delete globalThis.__briefFixture;
    delete globalThis.__briefRenders;
  }
});
