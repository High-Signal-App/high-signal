import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  freshReaderManifest,
  readerSelection,
  serveReaderArtifact,
  READER_MANIFEST_KEY,
} from '../apps/web/reader-artifacts.mjs';
import { publishArtifacts } from '../apps/reader/scripts/publish-artifacts.mjs';

const source = 'a'.repeat(40);
const now = Date.parse('2026-10-12T10:00:00Z');
const hash = (body) => createHash('sha256').update(body).digest('hex');
const request = (path, options) => new Request(`https://highsignal.app${path}`, options);
const regions = [
  'global',
  'north-america',
  'europe',
  'south-asia',
  'east-asia',
  'southeast-asia',
  'latam',
  'mena',
  'africa',
  'oceania',
];
const build = {
  source,
  profiles: 1,
  indexableProfiles: ['openai'],
  assets: { '_astro/reader.js': hash('js') },
};

function publication() {
  const directory = mkdtempSync(resolve(tmpdir(), 'reader-publication-'));
  const manifest = {
    schema: 1,
    source,
    capturedAt: new Date(now).toISOString(),
    editionDay: '2026-10-12',
    assets: build.assets,
    briefs: [],
  };
  const objects = new Map();
  for (const day of ['today', 'yesterday']) {
    mkdirSync(resolve(directory, 'reader-artifacts/brief', day), { recursive: true });
    for (const region of regions) {
      const entry = { day, region };
      for (const [format, extension] of [
        ['html', 'html'],
        ['markdown', 'md'],
      ]) {
        const body =
          format === 'html'
            ? `<main data-high-signal-reader="brief-v1" data-edition-date="2026-10-${day === 'today' ? '12' : '11'}">${day}/${region}</main>`
            : `# ${day}/${region}`;
        const sha256 = hash(body);
        const path = `brief/${day}/${region}.${extension}`;
        const key = `reader/v1/${source}/${sha256}.${extension}`;
        writeFileSync(resolve(directory, 'reader-artifacts', path), body);
        objects.set(key, body);
        entry[format] = { path, key, sha256 };
      }
      manifest.briefs.push(entry);
    }
  }
  writeFileSync(resolve(directory, 'reader-manifest.json'), JSON.stringify(manifest));
  const pointer = {
    ...manifest,
    slot: 0,
    briefs: manifest.briefs.map((entry) => ({
      ...entry,
      html: { ...entry.html, key: `reader/v1/slots/0/${entry.day}/${entry.region}.html` },
    })),
  };
  for (const entry of pointer.briefs)
    objects.set(
      entry.html.key,
      objects.get(
        manifest.briefs.find((old) => old.day === entry.day && old.region === entry.region).html.key
      )
    );
  objects.set(READER_MANIFEST_KEY, JSON.stringify(pointer));
  return { directory, manifest, objects };
}

function runtime(objects) {
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const storage = new Map();
  const cache = {
    match: async (key) => {
      const stored = storage.get(key.url);
      return stored && new Response(stored.body.slice(0), { headers: stored.headers });
    },
    put: async (key, value) => {
      storage.set(key.url, {
        body: await value.arrayBuffer(),
        headers: new Headers(value.headers),
      });
    },
  };
  let profileReads = 0;
  const env = {
    ASSETS: {
      fetch: async (asset) => {
        profileReads++;
        return new Response(
          asset.url.endsWith('openai.reader') ? '<main>OpenAI</main>' : 'missing',
          {
            status: asset.url.endsWith('openai.reader') ? 200 : 404,
          }
        );
      },
    },
    NEXT_INC_CACHE_R2_BUCKET: {
      get: async (key) => {
        const body = objects.get(key);
        return body === undefined
          ? null
          : {
              body,
              text: async () => body,
              httpEtag: '"artifact"',
              arrayBuffer: async () => new TextEncoder().encode(body).buffer,
            };
      },
    },
  };
  return { env, ctx, cache, settle: () => Promise.all(pending), reads: () => profileReads };
}

test('reader variants preserve selectors and bypass private or framework requests', () => {
  assert.equal(readerSelection(request('/?day=yesterday&region=europe')).day, 'yesterday');
  assert.equal(readerSelection(request('/case-studies/openai.md')).markdown, true);
  assert.equal(
    readerSelection(request('/case-studies/openai', { headers: { Accept: 'text/markdown' } }))
      .markdown,
    true
  );
  for (const path of [
    '/?day=2026-10-10',
    '/?day=today&day=yesterday',
    '/?news_page=2',
    '/?probe=x',
    '/case-studies/search',
    '/case-studies/openai?preview=1',
    '/_private/reader/profiles/openai.reader',
  ])
    assert.equal(readerSelection(request(path)), null, path);
  for (const headers of [
    { Authorization: 'Bearer local-test' },
    { RSC: '1' },
    { Cookie: 'high-signal-history=test' },
  ])
    assert.equal(readerSelection(request('/case-studies/openai', { headers })), null);
  assert.equal(
    readerSelection(request('/', { headers: { Accept: 'text/markdown' } })),
    null,
    'Root Markdown remains the agent catalog'
  );
});

test('freshness rejects another deployment, expiry, future captures and IST rollover', () => {
  const { manifest } = publication();
  assert.equal(freshReaderManifest(manifest, source, now), true);
  assert.equal(freshReaderManifest(manifest, 'b'.repeat(40), now), false);
  assert.equal(freshReaderManifest(manifest, source, now + 300_000), false);
  assert.equal(freshReaderManifest(manifest, source, now - 30_001), false);
  const midnight = Date.parse('2026-10-12T18:30:00Z');
  assert.equal(
    freshReaderManifest(
      { ...manifest, capturedAt: new Date(midnight - 1).toISOString() },
      source,
      midnight
    ),
    false
  );
  assert.equal(freshReaderManifest({ ...manifest, briefs: [] }, source, now), false);
});

test('briefs retain region, browser revalidation and freshness gate before warm body cache', async () => {
  const { objects } = publication();
  const run = runtime(objects);
  const read = (path, clock = now) =>
    serveReaderArtifact(request(path), run.env, run.ctx, build, run.cache, clock);
  const first = await read('/?region=europe&day=yesterday');
  assert.equal(
    await first.text(),
    '<main data-high-signal-reader="brief-v1" data-edition-date="2026-10-11">yesterday/europe</main>'
  );
  assert.equal(first.headers.get('Cache-Control'), 'private, no-cache');
  assert.equal(first.headers.get('x-reader-renderer'), 'astro');
  await run.settle();
  assert.equal((await read('/?region=europe&day=yesterday')).headers.get('x-edge-cache'), 'HIT');
  assert.match(await (await read('/?region=invalid')).text(), /today\/global/);
  assert.equal(
    await read('/', now + 300_000),
    null,
    'Expired publication delegates even with warm cache'
  );
  assert.equal(await read('/?day=2026-10-10'), null, 'Protected history delegates');
});

test('profiles use deployed assets, preserve noindex, and missing lookups delegate without negative caching', async () => {
  const run = runtime(new Map());
  const first = await serveReaderArtifact(
    request('/case-studies/openai'),
    run.env,
    run.ctx,
    build,
    run.cache,
    now
  );
  assert.equal(await first.text(), '<main>OpenAI</main>');
  await run.settle();
  const head = await serveReaderArtifact(
    request('/case-studies/openai', { method: 'HEAD' }),
    run.env,
    run.ctx,
    build,
    run.cache,
    now
  );
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('x-edge-cache'), 'HIT');
  assert.equal(run.reads(), 1);
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal(
      await serveReaderArtifact(
        request('/case-studies/new-company'),
        run.env,
        run.ctx,
        build,
        run.cache,
        now
      ),
      null
    );
  assert.equal(run.reads(), 3);
  const noindex = await serveReaderArtifact(
    request('/case-studies/openai'),
    run.env,
    run.ctx,
    { ...build, indexableProfiles: [] },
    run.cache,
    now
  );
  assert.equal(noindex.headers.get('X-Robots-Tag'), 'noindex, follow');
});

test('publisher promotes only after all variants and a deployment recheck', async () => {
  const { directory } = publication();
  const writes = [];
  const count = await publishArtifacts({
    directory,
    deployed: build,
    now: () => now,
    put: async (key) => writes.push(key),
    recheck: async () => {
      assert.equal(writes.length, 20);
      return build;
    },
  });
  assert.equal(count, 20);
  assert.equal(writes.length, 21);
  assert.equal(writes.at(-1), READER_MANIFEST_KEY);
});

test('publication failures keep the old pointer intact', async () => {
  for (const failure of [
    'upload',
    'source-race',
    'asset-race',
    'expired',
    'checksum',
    'incomplete',
  ]) {
    const { directory, manifest } = publication();
    const writes = [];
    if (failure === 'checksum')
      writeFileSync(
        resolve(directory, 'reader-artifacts', manifest.briefs[0].html.path),
        'truncated'
      );
    if (failure === 'incomplete') {
      manifest.briefs[0].day = 'yesterday';
      writeFileSync(resolve(directory, 'reader-manifest.json'), JSON.stringify(manifest));
    }
    let clockReads = 0;
    await assert.rejects(
      publishArtifacts({
        directory,
        deployed: build,
        now: () => now + (failure === 'expired' && clockReads++ ? 300_000 : 0),
        put: async (key) => {
          if (failure === 'upload') throw new Error('local upload failure');
          writes.push(key);
        },
        recheck: async () =>
          failure === 'source-race'
            ? { ...build, source: 'b'.repeat(40) }
            : failure === 'asset-race'
              ? { ...build, assets: {} }
              : build,
      }),
      undefined,
      failure
    );
    assert.equal(writes.includes(READER_MANIFEST_KEY), false, failure);
  }
});

test('reader deployment never overlays the root and uses the same browser assets as publication', () => {
  const config = readFileSync(
    new URL('../apps/web/scripts/overlay-reader.mjs', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(config, /['"]index\.html['"]/);
  const packageJson = JSON.parse(
    readFileSync(new URL('../apps/web/package.json', import.meta.url))
  );
  assert.match(packageJson.scripts['cf:build'], /READER_BUILD_MODE=profiles/);
  assert.match(packageJson.scripts['cf:build'], /overlay-reader\.mjs/);
});

test('rotating publications remain bounded and duplicate events do not write again', async () => {
  const { directory, manifest } = publication();
  const stored = new Map();
  let clock = now;
  const options = {
    directory,
    deployed: build,
    now: () => clock,
    put: async (key, body) => stored.set(key, body),
    recheck: async () => build,
    getCurrent: async () =>
      stored.has(READER_MANIFEST_KEY)
        ? JSON.parse(stored.get(READER_MANIFEST_KEY).toString())
        : null,
  };
  for (const slot of [0, 1, 0]) {
    manifest.capturedAt = new Date(clock).toISOString();
    writeFileSync(resolve(directory, 'reader-manifest.json'), JSON.stringify(manifest));
    assert.equal(await publishArtifacts(options), 20);
    assert.equal((await options.getCurrent()).slot, slot);
    const before = new Map(stored);
    assert.equal(await publishArtifacts(options), 0);
    assert.deepEqual(stored, before);
    clock += 120_000;
  }
  assert.equal(stored.size, 41, 'Only two sets of twenty HTML variants plus the pointer');
});

test('a corrupted reused slot cannot enter the body cache', async () => {
  const { objects } = publication();
  objects.set('reader/v1/slots/0/today/global.html', '<main>another generation</main>');
  const run = runtime(objects);
  assert.equal(
    await serveReaderArtifact(request('/'), run.env, run.ctx, build, run.cache, now),
    null
  );
});

test('publisher refuses historical bodies and concurrent pointer promotion', async () => {
  const { directory, manifest } = publication();
  let reads = 0;
  const writes = [];
  await assert.rejects(
    publishArtifacts({
      directory,
      deployed: build,
      now: () => now,
      put: async (key) => writes.push(key),
      recheck: async () => build,
      getCurrent: async () => (reads++ ? { source, slot: 1 } : null),
    }),
    /changed the current pointer/
  );
  assert.equal(writes.includes(READER_MANIFEST_KEY), false);
  const entry = manifest.briefs[0].html;
  const body =
    '<main data-high-signal-reader="brief-v1" data-edition-date="2026-10-01">protected</main>';
  entry.sha256 = hash(body);
  entry.key = `reader/v1/${source}/${entry.sha256}.html`;
  writeFileSync(resolve(directory, 'reader-artifacts', entry.path), body);
  writeFileSync(resolve(directory, 'reader-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(
    publishArtifacts({
      directory,
      deployed: build,
      now: () => now,
      put: async () => assert.fail('historical bytes must not upload'),
      recheck: async () => build,
    }),
    /public edition/
  );
});
