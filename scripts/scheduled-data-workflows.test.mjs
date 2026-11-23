#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nseScheduledSession } from './nse-scheduled-session.mjs';

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
assert.ok(nseJob.includes('elif [[ "$RUN_KIND" == schedule ]]'));
assert.ok(nseJob.includes('--allow-unpublished-weekend'));
assert.ok(nseJob.includes('scripts/nse-scheduled-session.mjs "$RUN_SCHEDULE" "$created_at"'));
for (const [schedule, createdAt, session] of [
  ['30 21 * * 0,6', '2026-11-23T01:55:32Z', '2026-11-22'],
  ['30 21 * * 1-5', '2026-11-20T02:28:39Z', '2026-11-19'],
  ['30 13 * * *', '2026-11-19T13:30:00Z', '2026-11-19'],
  ['30 13 * * *', '2026-11-19T02:42:51Z', '2026-11-18'],
  ['30 21 * * 1-5', '2026-11-23T09:00:00Z', '2026-11-20'],
]) {
  assert.equal(nseScheduledSession(schedule, createdAt), session);
}
// Exercise every schedule declared in the workflow. A new cadence must be
// supported by the session resolver before it can run in production.
const configuredSchedules = [...equitiesWorkflow.matchAll(/^\s*- cron: ["']([^"']+)["']/gm)];
assert.ok(configuredSchedules.length > 0);
for (const [, expression] of configuredSchedules) {
  assert.match(nseScheduledSession(expression, '2026-11-23T01:55:32Z'), /^\d{4}-\d{2}-\d{2}$/);
}
assert.throws(() => nseScheduledSession('unknown', '2026-11-19T13:30:00Z'));
assert.throws(() => nseScheduledSession('30 13 * * *', 'invalid'));
assert.ok(nseJob.includes("hashFiles('artifacts/nse/candidate.json')"));
assert.ok(!nseJob.includes('--limit'), 'daily NSE collection must not have a company cap');
assert.ok(nseJob.includes('nse_archive publish'), 'daily originals must survive the runner');
assert.ok(
  equitiesWorkflow.includes('Restore canonical NSE inputs into the shared price projection')
);
assert.ok(nseJob.includes('nse_archive consume'), 'retained inputs must pass a canonical read');
assert.ok(!nseJob.includes('git add'), 'raw NSE snapshots must never enter public Git');

console.log('scheduled-data-workflows.test.mjs: ok');
