import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { publicRecordDocument } from '../apps/web/public-record-document.mjs';
import { handlePublicRecordMarkdown } from '../apps/web/public-record-markdown.mjs';
import { recordFixture, recordFixtureApi } from '../apps/web/scripts/public-record-fixture.mjs';
import { publicSourceTree } from '../apps/web/src/lib/public-source-tree.ts';
import { absoluteMarkdownLinks } from '../apps/web/agent-surfaces/format.mjs';
import * as site from '../apps/web/src/lib/site.ts';
import * as routes from '../apps/web/public-route-registry.mjs';
import * as http from '../apps/web/agent-surfaces/http.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const ts = webRequire('typescript');
function authoredModule(path, imports) {
  const compiled = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports = {};
  new Function('require', 'exports', compiled.outputText)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected authored page import: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
function nativeImports(source, filename) {
  const dependencies = [];
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    assert.ok(
      !ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword,
      'Native record path must not dynamically load code'
    );
    if (
      (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly)
    ) {
      const dependency = node.moduleSpecifier.text;
      assert.ok(
        dependency.startsWith('.'),
        `Native record path must not load runtime package ${dependency}`
      );
      dependencies.push(resolve(dirname(filename), dependency));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return dependencies;
}
const request = (path, options) => new Request(`https://highsignal.app${path}`, options);
function context() {
  const pending = [];
  const entries = new Map();
  return {
    pending,
    entries,
    ctx: { waitUntil: (promise) => pending.push(promise) },
    options: {
      cacheBuildId: 'record-native-proof',
      cache: {
        match: async (key) => entries.get(key.url)?.clone(),
        put: async (key, value) => entries.set(key.url, value.clone()),
      },
    },
  };
}

test('record projection preserves the compiled baseline and provenance disclosures', async () => {
  const record = recordFixture('record-0000');
  const document = await publicRecordDocument('/data/records/record-0000', record);
  // Captured from the actual pre-fix workerd renderer with this fixed API fixture.
  assert.equal(
    createHash('sha256').update(document.markdown).digest('hex'),
    'efb6e2afc6e3a87082dbc2ae10766b09dc57e6cb8aeb0607f974be60a419ecc7'
  );
  for (const [fields, expected, absent] of [
    [{ retainedText: null, retainedTextTruncated: false }, 'only its metadata was stored', '```'],
    [
      { retainedText: null, retainedTextUnavailableReason: 'legacy_shared_document_mismatch' },
      'cannot be attributed to this record',
      '```',
    ],
    [{ content: record.retainedText }, 'retained text (truncated)', '## extract'],
    [{ title: null }, '# Retained record record-0000', '# Retained evidence record-0000'],
    [{ url: 'javascript:alert(1)', canonicalUrl: null }, 'original source ↗', '](javascript:'],
  ]) {
    const projected = await publicRecordDocument('/data/records/record-0000', {
      ...record,
      ...fields,
    });
    assert.ok(projected.markdown.includes(expected), expected);
    assert.ok(!projected.markdown.includes(absent), absent);
  }
});

test('native Markdown follows the actual authored page content and metadata', async () => {
  const Link = Symbol('authored-next-link');
  const metadata = authoredModule('apps/web/src/lib/agent-page-metadata.ts', {
    './site': site,
    '../../public-route-registry.mjs': routes,
    '../../agent-surfaces/http.mjs': http,
  });
  for (const fields of [
    {},
    { publishedAt: 0, ingestedAt: 0 },
    { publishedAt: null, ingestedAt: null },
    { retainedText: null, retainedTextTruncated: false },
    { retainedText: null, retainedTextUnavailableReason: 'legacy_shared_document_mismatch' },
    { content: null, title: null, entity: null },
    { title: 'A [title] & evidence', content: 'Text with <tags>, [links] and `code`.' },
    { url: 'javascript:alert(1)', canonicalUrl: null },
  ]) {
    const id = 'record-0000';
    const record = { ...recordFixture(id), ...fields };
    const page = authoredModule('apps/web/src/app/data/records/[id]/page.tsx', {
      '@/lib/agent-page-metadata': metadata,
      'react/jsx-runtime': webRequire('react/jsx-runtime'),
      'next/link': { __esModule: true, default: Link },
      '@/lib/api': { api: { dataRecord: async () => record } },
    });
    const props = { params: Promise.resolve({ id }) };
    const declared = await page.generateMetadata(props);
    const canonical = declared.alternates.canonical;
    const body = await publicSourceTree(await page.default(props), {
      canonical,
      adapters: new Map([
        [
          Link,
          async (values) =>
            `[${(await publicSourceTree(values.children, { canonical })).trim()}](${new URL(values.href, canonical).href})`,
        ],
      ]),
    });
    const expected = absoluteMarkdownLinks(
      `# ${declared.title}\n\n> ${declared.description}\n\nCanonical: ${canonical}\n\n${body.replace(/^# [^\n]*\n/m, '').trim()}\n`,
      canonical
    );
    const actual = await publicRecordDocument(`/data/records/${id}`, record);
    assert.equal(actual.markdown, expected, JSON.stringify(fields));
  }
});

test('every uncached record representation requires one credential-free API read', async () => {
  const calls = [];
  const env = { API: { fetch: recordFixtureApi(calls) } };
  const state = context();
  const paths = [
    '/data/records/record-0000.md',
    '/api/md/data/records/record-0001',
    '/data/records/record-0002',
    '/data/records/record-0003.md?ignored=1',
  ];
  for (const [index, path] of paths.entries()) {
    const response = await handlePublicRecordMarkdown(
      request(path, {
        headers: {
          Accept: 'text/markdown',
          Authorization: 'Bearer must-not-be-forwarded',
          Cookie: 'high-signal-history=must-not-be-forwarded',
          'cf-access-jwt-assertion': 'must-not-be-forwarded',
        },
      }),
      env,
      state.ctx,
      state.options
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, index + 1);
    assert.equal(
      response.headers.get('content-location'),
      `https://highsignal.app/data/records/record-000${index}`
    );
    assert.ok((await response.text()).includes(`Retained evidence record-000${index}`));
  }
  await Promise.all(state.pending);
  assert.equal(
    state.entries.size,
    0,
    'authenticated and query variants must not populate shared cache'
  );
  assert.ok(
    calls.every(
      (call) =>
        call.method === 'GET' && !call.search && !call.cookie && !call.authorization && !call.access
    )
  );
});

test('new IDs stay one-read misses while canonical aliases reuse completed content', async () => {
  const calls = [];
  const env = { API: { fetch: recordFixtureApi(calls) } };
  const state = context();
  for (let index = 0; index < 32; index++) {
    const id = `record-${String(index).padStart(4, '0')}`;
    const response = await handlePublicRecordMarkdown(
      request(`/data/records/${id}.md`),
      env,
      state.ctx,
      state.options
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-edge-cache'), 'AGENT-MISS');
    assert.equal(calls.length, index + 1);
    assert.ok((await response.text()).includes(`Retained evidence ${id}`));
  }
  await Promise.all(state.pending);
  const alias = await handlePublicRecordMarkdown(
    request('/api/md/data/records/record-0000'),
    env,
    state.ctx,
    state.options
  );
  assert.equal(alias.headers.get('x-edge-cache'), 'AGENT-HIT');
  assert.equal(calls.length, 32);
  assert.ok((await alias.text()).includes('Retained evidence record-0000'));
});

test('encoded record IDs are decoded once and retain an encoded canonical URL', async () => {
  for (const id of ['literal%2F', 'literal%', 'space here', 'name:part']) {
    const calls = [];
    const state = context();
    const response = await handlePublicRecordMarkdown(
      request(`/data/records/${encodeURIComponent(id)}.md`),
      { API: { fetch: recordFixtureApi(calls) } },
      state.ctx,
      state.options
    );
    assert.equal(response.status, 200, id);
    assert.equal(calls.length, 1);
    assert.equal(
      response.headers.get('content-location'),
      `https://highsignal.app/data/records/${encodeURIComponent(id)}`
    );
    assert.ok((await response.text()).includes(`Retained evidence ${id}`));
    await Promise.all(state.pending);
  }
});

test('missing and unavailable records preserve their errors and never enter response cache', async () => {
  for (const [api, expected] of [
    [async () => Response.json({ error: 'not_found' }, { status: 404 }), 404],
    [async () => Response.json({ id: 'record-0000', available: false }), 503],
    [
      async () => new Response('invalid JSON', { headers: { 'Content-Type': 'application/json' } }),
      503,
    ],
    [async () => Response.json({ ...recordFixture('record-0000'), id: 'wrong-record' }), 503],
    [
      async () => {
        throw new Error('API unavailable');
      },
      503,
    ],
  ]) {
    const state = context();
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await handlePublicRecordMarkdown(
        request('/data/records/record-0000.md'),
        { API: { fetch: api } },
        state.ctx,
        state.options
      );
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    await Promise.all(state.pending);
    assert.equal(state.entries.size, 0);
  }
});

test('HEAD, OPTIONS, invalid IDs and unrelated routes retain their HTTP boundaries', async () => {
  const calls = [];
  const env = { API: { fetch: recordFixtureApi(calls) } };
  const state = context();
  const head = await handlePublicRecordMarkdown(
    request('/data/records/record-0000.md', { method: 'HEAD' }),
    env,
    state.ctx,
    state.options
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(calls.length, 1);
  const options = await handlePublicRecordMarkdown(
    request('/api/md/data/records/record-0000', { method: 'OPTIONS' }),
    env,
    state.ctx,
    state.options
  );
  assert.equal(options.status, 204);
  assert.equal(calls.length, 1);
  for (const id of ['bad%2fpath', 'bad%5cpath', 'bad%3fquery', 'bad%23fragment', 'bad%ZZ']) {
    const response = await handlePublicRecordMarkdown(
      request(`/data/records/${id}.md`),
      env,
      state.ctx,
      state.options
    );
    assert.equal(response.status, 404, id);
  }
  assert.equal(calls.length, 1);
  for (const [path, options] of [
    ['/data/records/record-0000', {}],
    ['/data/records/record-0000.md', { method: 'POST' }],
    ['/api/md/admin', {}],
    ['/brief/2026-01-01.md', {}],
  ])
    assert.equal(
      await handlePublicRecordMarkdown(request(path, options), env, state.ctx, state.options),
      null
    );
});

test('the native import graph excludes Next, React runtime and the public page registry', () => {
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    visited.add(path);
    for (const next of nativeImports(readFileSync(path, 'utf8'), path)) {
      assert.doesNotMatch(next, /public-source-pages|legacy-worker|case-studies|company-universe/);
      visit(next);
    }
  }
  visit(resolve(root, 'apps/web/public-record-markdown.mjs'));
  assert.ok(visited.size > 3, 'the dependency graph check must traverse the actual handler');
  assert.throws(
    () => nativeImports("export * from 'next/server';", 'fixture.mjs'),
    /runtime package/
  );
  assert.throws(
    () =>
      nativeImports(
        "async function load() { return import('./legacy-worker.mjs'); }",
        'fixture.mjs'
      ),
    /dynamically load/
  );
});
