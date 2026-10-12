import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReaderRuntime, seedReaderBrief, WEB_ROOT } from './reader-runtime.mjs';

const { READER_BUILD } = await import(
  pathToFileURL(resolve(WEB_ROOT, '.open-next/reader-build.mjs'))
);
const mf = await createReaderRuntime();
async function read(path, headers = {}) {
  const response = await mf.dispatchFetch(`https://highsignal.app${path}`, {
    headers: { Accept: 'text/html', ...headers },
  });
  return { response, body: await response.text() };
}
try {
  const slugs = ['openai', 'index', ...READER_BUILD.indexableProfiles.slice(0, 30)];
  const times = [];
  for (const slug of slugs) {
    const { response, body } = await read(`/case-studies/${slug}`);
    assert.equal(response.status, 200, slug);
    assert.equal(response.headers.get('x-reader-renderer'), 'astro', slug);
    assert.equal(response.headers.get('x-edge-cache'), 'MISS', slug);
    assert.match(body, /company-profile-v1/, slug);
    assert.doesNotMatch(body, /_next\/static|__next_f/, 'Reader must not send Next hydration');
    times.push(Number(response.headers.get('server-timing')?.match(/dur=(\d+)/)?.[1]));
  }
  await new Promise((done) => setTimeout(done, 100));
  for (const slug of slugs) {
    const { response } = await read(`/case-studies/${slug}`);
    assert.equal(response.headers.get('x-edge-cache'), 'HIT', slug);
  }
  assert.equal((await read('/_private/reader/profiles/openai.reader')).response.status, 404);
  assert.equal((await read('/_private/reader/profiles/openai.md')).response.status, 404);
  for (const path of [
    '/\u00255fprivate/reader/profiles/openai.reader',
    '/_private\u00252freader/profiles/openai.reader',
  ]) {
    assert.equal((await read(path)).response.status, 404, path);
  }
  const metadata = await read('/api/reader-build');
  assert.equal(JSON.parse(metadata.body).source, READER_BUILD.source);
  const canonical = await mf.dispatchFetch('https://www.highsignal.app/case-studies/openai', {
    redirect: 'manual',
  });
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get('location'), 'https://highsignal.app/case-studies/openai');
  const md = await read('/case-studies/openai.md');
  assert.equal(md.response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(md.body, /OpenAI/);
  const flight = await read('/case-studies/openai?_rsc=local-test', { RSC: '1' });
  assert.equal(flight.response.headers.get('x-reader-renderer'), null);
  const history = await read('/brief/2026-10-01');
  assert.equal(history.response.headers.get('x-reader-renderer'), null);
  assert.doesNotMatch(history.body, /data-high-signal-reader="brief-v1"/);
  const directory = process.argv[2];
  if (directory) {
    const { bucket, pointer } = await seedReaderBrief(mf, resolve(directory));
    for (const { day, region } of pointer.briefs) {
      const { response, body } = await read(`/?day=${day}&region=${region}`);
      assert.equal(response.headers.get('x-reader-renderer'), 'astro', `${day}/${region}`);
      assert.equal(response.headers.get('cache-control'), 'private, no-cache');
      assert.match(body, /data-high-signal-reader="brief-v1"/);
      assert.ok(body.includes(`data-region="${region}"`));
    }
    assert.equal((await read('/?day=2026-10-01')).response.headers.get('x-reader-renderer'), null);
    assert.equal((await read('/_private/reader/brief/today/global.html')).response.status, 404);
    // Corruption and expired-pointer behavior also have direct executable gate tests.
    assert.ok(await bucket.get('reader/v1/current.json'));
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      runtime: 'workerd + real Static Assets + local R2',
      distinctProfiles: slugs.length,
      warmHits: slugs.length,
      coldHandlerWallMs: { median: times[Math.floor(times.length / 2)], max: times.at(-1) },
      briefVariants: directory ? 20 : 0,
      productionCpuOrHitRateMeasured: false,
    })
  );
} finally {
  await mf.dispose();
}
