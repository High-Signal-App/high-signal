import assert from 'node:assert/strict';

const source = process.argv[2] ?? process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(source ?? '')) throw new Error('Expected reader source SHA is required');
const read = (path) =>
  fetch(`https://highsignal.app${path}`, {
    headers: { Accept: 'text/html', 'User-Agent': 'HighSignal-reader-smoke/1 (undici)' },
    signal: AbortSignal.timeout(30_000),
  });
const metadata = await read('/api/reader-build');
assert.equal(metadata.status, 200);
const build = await metadata.json();
assert.equal(build.source, source);
assert.ok(build.profiles > 0);
for (const slug of ['openai', 'index']) {
  const response = await read(`/case-studies/${slug}`);
  assert.equal(response.status, 200, slug);
  assert.equal(response.headers.get('x-reader-renderer'), 'astro', slug);
  const body = await response.text();
  assert.match(body, /company-profile-v1/);
  assert.doesNotMatch(body, /_next\/static|__next_f/);
}
assert.equal((await read('/_private/reader/profiles/openai.reader')).status, 404);
console.log(`Reader source ${source}: compiled profiles and internal-asset boundary verified.`);
