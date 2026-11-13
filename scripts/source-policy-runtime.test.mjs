import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const api = fileURLToPath(new URL('../workers/api/', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const suites = [
  [
    'API policy ownership and publication',
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      'src/__tests__/admin-signal-review.test.ts',
      'src/__tests__/admin-sync-proofs.test.ts',
      'src/__tests__/source-documents.test.ts',
    ],
    api,
  ],
  ['SQL import policy', tsx, ['scripts/sync-signals.test.ts'], root],
  ['Publisher policy grounding', tsx, ['scripts/auto-publish-transport.test.ts'], root],
  [
    'Retained Python policy reconstruction',
    'uv',
    ['run', '--project', 'python/ingest', '--no-sync', 'pytest', '-q',
      'python/ingest/tests/test_evidence_origins.py',
      'python/ingest/tests/test_retained_corroboration.py',
      'python/ingest/tests/test_digg_verify.py'],
    root,
  ],
];

for (const [name, command, args, cwd] of suites) {
  test(name, { timeout: 70_000 }, () => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}
