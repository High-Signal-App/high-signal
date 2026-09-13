#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const backtestWorkflow = await readFile('.github/workflows/cron-backtest.yml', 'utf8');
const publishWorkflow = await readFile('.github/workflows/cron-publish.yml', 'utf8');
const backtestScript = await readFile('scripts/backtest-convergence-labels.py', 'utf8');

for (const [name, workflow] of [['backtest', backtestWorkflow]]) {
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
assert.ok(publishWorkflow.includes('node scripts/precompute-daily-brief.mjs'));
assert.ok(publishWorkflow.includes('node scripts/verify-daily-brief.mjs'));

console.log('scheduled-data-workflows.test.mjs: ok');
