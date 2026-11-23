import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  handlePublicRecordHtml,
  publicRecordHtmlSelection,
} from '../apps/web/public-record-html.mjs';

const request = (path, options) => new Request(`https://highsignal.app${path}`, options);

test('only anonymous record HTML enters the compiled reader', () => {
  for (const id of ['record-0000', 'literal%2F', 'space here', 'name:part']) {
    assert.deepEqual(
      publicRecordHtmlSelection(
        request(`/data/records/${encodeURIComponent(id)}?utm_source=reader`)
      ),
      {
        id,
        path: `/data/records/${encodeURIComponent(id)}`,
      }
    );
  }
  for (const [path, options] of [
    ['/data/records/record-0000.md', {}],
    ['/api/md/data/records/record-0000', {}],
    ['/data/records/record-0000', { headers: { Accept: 'text/markdown' } }],
    ['/data/records/record-0000', { method: 'POST' }],
    ['/data/records/record-0000', { headers: { Authorization: 'Bearer test' } }],
    ['/data/records/record-0000', { headers: { 'cf-access-jwt-assertion': 'test' } }],
    ['/data/records/record-0000', { headers: { Cookie: 'high-signal-history=test' } }],
    ['/data/records/record-0000', { headers: { Cookie: 'CF_Authorization=test' } }],
    ['/data/records/record-0000?_rsc=example', { headers: { RSC: '1' } }],
    ['/data/records/record-0000', { headers: { 'next-router-state-tree': 'test' } }],
    ['/data/records/record-0000', { headers: { 'next-router-prefetch': '1' } }],
    ['/data/records/record-0000', { headers: { 'next-url': '/data' } }],
    ['/data/records/record-0000?day=2026-01-01', {}],
    ['/brief/2026-01-01', {}],
    ['/data/records/bad%2fpath', {}],
    ['/data/records/bad%5cpath', {}],
    ['/data/records/bad%3fquery', {}],
    ['/data/records/bad%23fragment', {}],
    ['/data/records/bad%ZZ', {}],
  ])
    assert.equal(publicRecordHtmlSelection(request(path, options)), null, path);
  assert.ok(publicRecordHtmlSelection(request('/data/records/record-0000', { method: 'HEAD' })));
});

test('protected and router requests cannot read a public record cache or binding', async () => {
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error('Public dependency reached');
      },
    }
  );
  for (const headers of [
    { Authorization: 'Bearer test' },
    { 'cf-access-jwt-assertion': 'test' },
    { Cookie: 'high-signal-history=test' },
    { RSC: '1' },
    { 'next-router-state-tree': 'test' },
  ])
    assert.equal(
      await handlePublicRecordHtml(
        request('/data/records/record-0000', { headers }),
        forbidden,
        forbidden,
        { cache: forbidden, cacheBuildId: 'test' }
      ),
      null
    );
});

test('a missing or invalid compiled shell preserves the existing renderer without reading records', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response('<main>wrong build</main>'),
  ]) {
    const env = {
      ASSETS: { fetch: async () => response },
      API: {
        fetch() {
          throw new Error('Record read before a valid shell');
        },
      },
    };
    assert.equal(
      await handlePublicRecordHtml(
        request('/data/records/record-0000'),
        env,
        { waitUntil() {} },
        { cacheBuildId: 'valid-build' }
      ),
      null
    );
  }
});

test('a new build cannot reuse a previous record HTML cache entry', async () => {
  const stored = new Response('previous build', {
    headers: { 'x-reader-renderer': 'astro-record' },
  });
  const cache = {
    match: async (key) => (key.url.includes('/old-build/record/') ? stored.clone() : undefined),
  };
  const env = { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } };
  const old = await handlePublicRecordHtml(
    request('/data/records/record-0000'),
    env,
    {},
    { cache, cacheBuildId: 'old-build' }
  );
  assert.equal(await old.text(), 'previous build');
  assert.equal(
    await handlePublicRecordHtml(
      request('/data/records/record-0000'),
      env,
      {},
      { cache, cacheBuildId: 'new-build' }
    ),
    null
  );
});

test('cache lookup rejection preserves the existing renderer when the shell is unavailable', async () => {
  const cache = {
    match: async () => {
      throw new Error('Cache unavailable');
    },
  };
  const env = { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } };
  assert.equal(
    await handlePublicRecordHtml(
      request('/data/records/record-0000'),
      env,
      {},
      { cache, cacheBuildId: 'build' }
    ),
    null
  );
});

test('record cache diagnostics aggregate state, warm hits, HEAD misses, and put settlement', async () => {
  const previousRewriter = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = class {
    on() {
      return this;
    }

    transform(response) {
      return response;
    }
  };
  try {
    const record = {
      id: 'record-0000',
      available: true,
      source: 'wire',
      family: 'news',
      url: 'https://example.com/story',
      canonicalUrl: null,
      title: 'Example story',
      content: null,
      retainedText: null,
      retainedTextTruncated: false,
      retainedTextUnavailableReason: null,
      entity: null,
      entityName: null,
      publishedAt: null,
      ingestedAt: null,
      documentFetchedAt: null,
    };
    const entries = new Map();
    const cache = {
      async match(key) {
        return entries.get(key.url)?.clone();
      },
      async put(key, response) {
        entries.set(key.url, response.clone());
      },
    };
    const env = {
      ASSETS: { fetch: async () => new Response('<html data-record-reader="v1"></html>') },
      API: { fetch: async () => Response.json(record) },
    };
    const cacheOutcomes = [];
    const putOutcomes = [];
    const pending = [];
    const ctx = {
      waitUntil(promise) {
        pending.push(promise);
      },
    };
    const options = {
      cache,
      cacheBuildId: 'test-build',
      onCacheOutcome: (outcome) => cacheOutcomes.push(outcome),
      onPutOutcome: (outcome) => putOutcomes.push(outcome),
    };
    const cold = await handlePublicRecordHtml(
      request('/data/records/record-0000'),
      env,
      ctx,
      options
    );
    assert.equal(cold.headers.get('x-edge-cache'), 'MISS');
    assert.equal(cold.headers.get('cache-control'), 'public, max-age=60, s-maxage=300');
    assert.deepEqual(cacheOutcomes[0], {
      state: 'available',
      method: 'GET',
      hit: false,
      matchError: false,
    });
    assert.deepEqual(putOutcomes, ['scheduled']);
    await Promise.all(pending);
    assert.deepEqual(putOutcomes, ['scheduled', 'fulfilled']);

    const warm = await handlePublicRecordHtml(
      request('/data/records/record-0000'),
      env,
      ctx,
      options
    );
    assert.equal(warm.headers.get('x-edge-cache'), 'HIT');
    assert.equal(cacheOutcomes[1].state, 'available');
    assert.equal(cacheOutcomes[1].hit, true);

    const headOutcomes = [];
    const missingEnv = {
      ASSETS: env.ASSETS,
      API: { fetch: async () => new Response(null, { status: 404 }) },
    };
    const head = await handlePublicRecordHtml(
      request('/data/records/record-0001', { method: 'HEAD' }),
      missingEnv,
      ctx,
      {
        cache: {
          async match() {
            return undefined;
          },
          async put() {
            throw new Error('HEAD misses must not write');
          },
        },
        cacheBuildId: 'test-build',
        onCacheOutcome: (outcome) => headOutcomes.push(outcome),
        onPutOutcome: () => assert.fail('HEAD must not schedule a put'),
      }
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(headOutcomes[0], {
      state: 'missing',
      method: 'HEAD',
      hit: false,
      matchError: false,
    });

    const failedCacheOutcomes = [];
    const failedPutOutcomes = [];
    const failedPending = [];
    const failed = await handlePublicRecordHtml(
      request('/data/records/record-0000'),
      env,
      {
        waitUntil(promise) {
          failedPending.push(promise);
        },
      },
      {
        cache: {
          async match() {
            throw new Error('simulated cache read failure');
          },
          async put() {
            throw new Error('simulated cache write failure');
          },
        },
        cacheBuildId: 'test-build',
        onCacheOutcome: (outcome) => failedCacheOutcomes.push(outcome),
        onPutOutcome: (outcome) => failedPutOutcomes.push(outcome),
      }
    );
    assert.equal(failed.status, 200);
    assert.equal(failedCacheOutcomes[0].matchError, true);
    assert.deepEqual(failedPutOutcomes, ['scheduled']);
    await Promise.all(failedPending);
    assert.deepEqual(failedPutOutcomes, ['scheduled', 'rejected']);

    const observerPending = [];
    await handlePublicRecordHtml(
      request('/data/records/record-0000'),
      env,
      {
        waitUntil(promise) {
          observerPending.push(promise);
        },
      },
      {
        cache,
        cacheBuildId: 'test-build',
        onPutOutcome(outcome) {
          if (outcome === 'fulfilled') throw new Error('diagnostic callback failed');
        },
      }
    );
    await assert.doesNotReject(Promise.all(observerPending));
  } finally {
    if (previousRewriter === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = previousRewriter;
  }
});

test('record parity detects unsafe actual URLs and changed inline spacing', () => {
  const parse = (expected, actual) =>
    JSON.parse(
      execFileSync(
        'python3',
        [fileURLToPath(new URL('../apps/web/scripts/record_html_contract.py', import.meta.url))],
        { input: JSON.stringify([expected, actual]), encoding: 'utf8' }
      )
    );
  const unsafe = '<main><a href="javascript:alert(1)">source</a></main>';
  const [expected, actual] = parse(unsafe, unsafe);
  assert.deepEqual(expected.unsafeUrls, []);
  assert.deepEqual(actual.unsafeUrls, ['javascript:alert(1)']);
  assert.notDeepEqual(actual.main, expected.main);
  const [spaced, joined] = parse(
    '<main>Read <a>source</a> here</main>',
    '<main>Read<a>source</a>here</main>'
  );
  assert.notDeepEqual(spaced.main, joined.main);
  const [pre, trimmed] = parse(
    '<main><pre>\n body \n</pre></main>',
    '<main><pre>body</pre></main>'
  );
  assert.notDeepEqual(pre.main, trimmed.main);
  const [multiline, flattened] = parse(
    '<main><p class="whitespace-pre-wrap">line one\n  line two</p></main>',
    '<main><p class="whitespace-pre-wrap">line one line two</p></main>'
  );
  assert.notDeepEqual(multiline.main, flattened.main);
});
