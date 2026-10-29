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

const equitiesWorkflow = await readFile('.github/workflows/cron-equities.yml', 'utf8');
const nseJob = equitiesWorkflow.split('  nse:')[1]?.split('  equities:')[0];
assert.ok(nseJob, 'the canonical equities workflow must own full NSE collection');
assert.ok(equitiesWorkflow.includes('30 13 * * *'), 'NSE must refresh after India close');
assert.ok(nseJob.includes('--market nse'));
assert.ok(!nseJob.includes('--limit'), 'daily NSE collection must not have a company cap');
assert.ok(nseJob.includes('nse_archive publish'), 'daily originals must survive the runner');
assert.ok(
  equitiesWorkflow.includes('Restore canonical NSE inputs into the shared price projection')
);
assert.ok(nseJob.includes('nse_archive consume'), 'retained inputs must pass a canonical read');
assert.ok(!nseJob.includes('git add'), 'raw NSE snapshots must never enter public Git');

console.log('scheduled-data-workflows.test.mjs: ok');
