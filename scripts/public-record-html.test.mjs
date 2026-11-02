import assert from 'node:assert/strict';
import test from 'node:test';
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
