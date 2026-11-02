import assert from 'node:assert/strict';
import { createReaderRuntime } from './reader-runtime.mjs';
import { recordFixture, recordFixtureApi } from './public-record-fixture.mjs';

const calls = [];
const normalApi = recordFixtureApi(calls);
const cases = {
  empty: {
    retainedText: null,
    retainedTextTruncated: false,
    content: null,
    entity: null,
    publishedAt: 0,
    ingestedAt: null,
    documentFetchedAt: null,
  },
  mismatch: {
    retainedText: null,
    retainedTextUnavailableReason: 'legacy_shared_document_mismatch',
  },
  identical: { content: recordFixture('identical').retainedText },
  unsafe: {
    title: '<script>alert(1)</script>',
    content: '<img src=x onerror=alert(1)>',
    url: 'javascript:alert(1)',
    canonicalUrl: '<script>canonical</script>',
  },
  wrong: { id: 'sibling-record' },
};
const mf = await createReaderRuntime(undefined, undefined, {
  api: async (request) => {
    const id = decodeURIComponent(new URL(request.url).pathname.split('/').at(-1));
    if (!Object.hasOwn(cases, id)) return normalApi(request);
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      cookie: request.headers.get('cookie'),
      authorization: request.headers.get('authorization'),
      access: request.headers.get('cf-access-jwt-assertion'),
    });
    return Response.json({ ...recordFixture(id), ...cases[id] });
  },
});
async function read(id, options = {}) {
  const response = await mf.dispatchFetch(`https://highsignal.app/data/records/${id}`, {
    ...options,
    headers: { Accept: 'text/html', ...options.headers },
  });
  return { response, body: await response.text() };
}
try {
  const first = await read('record-0000');
  assert.equal(first.response.status, 200);
  assert.equal(first.response.headers.get('x-reader-renderer'), 'astro-record');
  assert.equal(first.response.headers.get('x-edge-cache'), 'MISS');
  assert.equal(calls.length, 1, 'a first-seen HTML record needs one public API read');
  assert.match(first.body, /Retained evidence record-0000/);
  assert.match(first.body, /Original extract for record-0000/);
  assert.doesNotMatch(first.body, /__record_template__|__next_f|_next\/static/);
  await new Promise((done) => setTimeout(done, 100));
  const second = await read('record-0000?utm_source=reader');
  assert.equal(second.response.headers.get('x-edge-cache'), 'HIT');
  assert.equal(second.body, first.body);
  const head = await read('record-0000', { method: 'HEAD' });
  assert.equal(head.response.headers.get('x-edge-cache'), 'HIT');
  assert.equal(head.body, '');
  assert.equal(calls.length, 1, 'cached GET and HEAD cannot read the API');
  const empty = await read('empty');
  assert.match(empty.body, /only its metadata was stored/);
  assert.doesNotMatch(
    empty.body,
    /<pre|data-record-group="extract"|data-record-link="entity"|data-record-text="fetched"/
  );
  assert.match(empty.body, /published —/);
  assert.match(empty.body, /ingested —/);
  const mismatch = await read('mismatch');
  assert.match(mismatch.body, /cannot be attributed to this record/);
  assert.doesNotMatch(mismatch.body, /<pre/);
  const identical = await read('identical');
  assert.doesNotMatch(identical.body, /data-record-group="extract"/);
  const unsafe = await read('unsafe');
  assert.match(unsafe.body, /&lt;script&gt;alert/);
  assert.match(unsafe.body, /&lt;img src=x onerror/);
  assert.doesNotMatch(unsafe.body, /<script>alert|<img src=x|href="javascript:/);
  for (const id of ['missing', 'unavailable', 'wrong']) {
    const before = calls.length;
    for (let repeat = 0; repeat < 2; repeat++) {
      const failed = await read(id);
      assert.equal(failed.response.status, 200, 'preserve current HTML error status');
      assert.equal(failed.response.headers.get('cache-control'), 'private, no-store');
      assert.match(
        failed.body,
        id === 'missing' ? /No retained record exists/ : /Record store not reachable/
      );
      assert.doesNotMatch(
        failed.body,
        /__record_template__|data-record-state="available"|__next_f/
      );
    }
    assert.equal(calls.length, before + 2, 'unavailable and missing records cannot be cached');
  }
  for (const id of ['literal%2F', 'literal%', 'space here', 'name:part']) {
    const encoded = encodeURIComponent(id);
    const result = await read(encoded);
    assert.equal(result.response.status, 200);
    assert.ok(result.body.includes(`https://highsignal.app/data/records/${encoded}`));
    assert.ok(result.body.includes(`Retained evidence ${id}`));
  }
  for (const headers of [
    { Cookie: 'high-signal-history=test' },
    { RSC: '1' },
    { 'cf-access-jwt-assertion': 'test' },
  ]) {
    const result = await read('record-0000', { headers });
    assert.equal(
      result.response.headers.get('x-reader-renderer'),
      null,
      'protected/router traffic must retain Next'
    );
  }
  const markdown = await read('record-0000.md');
  assert.equal(markdown.response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  for (const path of [
    '/_private/reader/record-shell.reader',
    '/%5fprivate/reader/record-shell.reader',
  ]) {
    assert.equal((await mf.dispatchFetch(`https://highsignal.app${path}`)).status, 404);
  }
  assert.ok(
    calls.every((call) => !call.cookie && !call.authorization && !call.access),
    'record API reads must not forward reader credentials'
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled Worker + workerd + actual Static Assets',
      publicMissReads: 1,
      cachedGetAndHeadReads: 0,
      encodedIds: 4,
      errorStatesUncached: 3,
      xssAndProtectedFallback: 'passed',
      billedCpuMeasured: false,
    })
  );
} finally {
  await mf.dispose();
}
