#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const backtestWorkflow = await readFile('.github/workflows/cron-backtest.yml', 'utf8');
const d2cWorkflow = await readFile('.github/workflows/cron-d2c-opportunities.yml', 'utf8');
const publishWorkflow = await readFile('.github/workflows/cron-publish.yml', 'utf8');
const backtestScript = await readFile('scripts/backtest-convergence-labels.py', 'utf8');
const d2cSnapshotSync = await readFile('scripts/sync-d2c-opportunities.ts', 'utf8');
const d2cVisibilitySync = await readFile('scripts/sync-d2c-agent-visibility.ts', 'utf8');

for (const [name, workflow] of [
  ['backtest', backtestWorkflow],
  ['d2c', d2cWorkflow],
]) {
  assert.ok(workflow.includes('ADMIN_TOKEN'), `${name} must authenticate through the admin API`);
  assert.ok(workflow.includes('API_BASE'), `${name} must target the configured API`);
  assert.ok(
    !workflow.includes('CLOUDFLARE_API_TOKEN'),
    `${name} must not hold a Cloudflare account token`
  );
  assert.ok(
    !workflow.includes('CLOUDFLARE_ACCOUNT_ID'),
    `${name} must not bypass the API with direct account access`
  );
}

assert.ok(backtestScript.includes('/admin/scheduled-data/backtest'));
assert.ok(!backtestScript.includes('wrangler'));
assert.ok(d2cWorkflow.includes('pnpm d2c:sync:api'));
assert.ok(d2cWorkflow.includes('pnpm d2c:sync-av:api'));
assert.ok(publishWorkflow.includes('node scripts/precompute-daily-brief.mjs'));
assert.ok(publishWorkflow.includes('node scripts/verify-daily-brief.mjs'));
for (const script of [d2cSnapshotSync, d2cVisibilitySync]) {
  assert.ok(script.includes('Math.floor(ms / 1000)'), 'D1 timestamps must use epoch seconds');
  assert.ok(
    script.includes('MAX_VALID_EPOCH_SECONDS'),
    'D2C sync must clean impossible legacy timestamps'
  );
}

console.log('scheduled-data-workflows.test.mjs: ok');
