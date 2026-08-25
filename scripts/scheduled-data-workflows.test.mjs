#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const backtestWorkflow = await readFile('.github/workflows/cron-backtest.yml', 'utf8');
const d2cWorkflow = await readFile('.github/workflows/cron-d2c-opportunities.yml', 'utf8');
const backtestScript = await readFile('scripts/backtest-convergence-labels.py', 'utf8');

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

console.log('scheduled-data-workflows.test.mjs: ok');
