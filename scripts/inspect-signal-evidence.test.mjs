import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSignalEvidence } from './inspect-signal-evidence.mjs';

const config = { api: 'https://api.example.org/', token: 'synthetic-token', slug: 'draft-example' };
test('inspection uses the protected read-only route and returns counts without retained text', async () => {
  const result = await inspectSignalEvidence({
    ...config,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.example.org/admin/signals-review/draft-example');
      assert.equal(init.method ?? 'GET', 'GET');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
      assert.equal(init.cache, 'no-store');
      return Response.json({
        claims: [
          {
            evidence: [
              { evidenceUrl: 'https://one.example', sourceDocumentId: 'one' },
              { evidenceUrl: 'https://one.example', sourceDocumentId: 'one' },
              { evidenceUrl: 'https://two.example', sourceDocumentId: null },
            ],
          },
        ],
        evidence: [
          { excerpt: 'retained source text', sourceType: 'news' },
          { excerpt: '  ', sourceType: 'techmeme' },
        ],
      });
    },
  });
  assert.deepEqual(result, {
    slug: 'draft-example',
    claims: 1,
    citedSources: 2,
    retainedTextSources: 1,
    linkedDocumentSources: 1,
    contextOnlySources: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /retained source text|synthetic-token/);
});

test('invalid slugs and missing credentials fail before any request', async () => {
  for (const overrides of [
    { token: '' },
    { slug: '../audit' },
    { slug: '' },
    { slug: 'x'.repeat(201) },
  ]) {
    await assert.rejects(
      () =>
        inspectSignalEvidence({
          ...config,
          ...overrides,
          fetchImpl: () => {
            throw new Error('unexpected request');
          },
        }),
      /Operator token required|Invalid signal slug/
    );
  }
});

test('operator denial stays explicit without logging response data', async () => {
  await assert.rejects(
    () =>
      inspectSignalEvidence({
        ...config,
        fetchImpl: async () => new Response('private upstream detail', { status: 401 }),
      }),
    /inspection failed \(HTTP 401\)/
  );
});
