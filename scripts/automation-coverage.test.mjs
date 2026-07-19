#!/usr/bin/env node
// automation-coverage.test.mjs — validates docs/operations/jobs.json structure
// and cross-references it against .github/workflows/*.yml and packages/db/src/schema.ts.
// Run: node scripts/automation-coverage.test.mjs

import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JOBS_JSON = resolve(ROOT, 'docs/operations/jobs.json');
const WORKFLOWS_DIR = resolve(ROOT, '.github/workflows');
const SCHEMA_FILE = resolve(ROOT, 'packages/db/src/schema.ts');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listWorkflows() {
  const entries = await readdir(WORKFLOWS_DIR);
  return entries.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

async function parseSchemaTables() {
  const content = await readFile(SCHEMA_FILE, 'utf8');
  const tables = new Set();
  for (const m of content.matchAll(/sqliteTable\(\s*["'`]([a-z_0-9]+)["'`]/g)) {
    tables.add(m[1]);
  }
  return tables;
}

function parseWorkflowTriggers(content) {
  if (!content) return null;
  const hasSchedule = /^\s*schedule:\s*$/m.test(content);
  const hasPush = /^\s*push:/m.test(content);
  const hasWorkflowDispatch = /workflow_dispatch:/.test(content);
  return { hasSchedule, hasPush, hasWorkflowDispatch };
}

async function runCoverageAudit() {
  return new Promise((res) => {
    const child = spawn('node', ['scripts/automation-coverage.mjs'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('close', (code) => res({ code, out, err }));
  });
}

const jobsJson = await readJson(JOBS_JSON);
const workflows = await listWorkflows();
const schemaTables = await parseSchemaTables();

// 1. Top-level shape
assert.ok(jobsJson.jobs && Array.isArray(jobsJson.jobs), 'jobs.json must have a jobs array');
assert.ok(
  jobsJson.surfaces && Array.isArray(jobsJson.surfaces),
  'jobs.json must have a surfaces array'
);
assert.ok(typeof jobsJson.version === 'number', 'jobs.json must have a numeric version');
assert.equal(jobsJson.project, 'high-signal');

// 2. Every job has the required fields per the spec
const REQUIRED_JOB_FIELDS = [
  'id',
  'kind',
  'owner',
  'trigger',
  'workflowFile',
  'runtime',
  'bounds',
  'idempotency',
  'freshness',
  'failureDestination',
  'evidence',
  'acceptedExceptions',
];
for (const job of jobsJson.jobs) {
  for (const field of REQUIRED_JOB_FIELDS) {
    assert.ok(job[field] !== undefined, `job ${job.id} missing required field: ${field}`);
  }
  assert.ok(
    typeof job.bounds.timeoutMinutes === 'number',
    `job ${job.id} bounds.timeoutMinutes must be number`
  );
  assert.ok(
    typeof job.bounds.concurrency === 'number',
    `job ${job.id} bounds.concurrency must be number`
  );
  assert.ok(
    typeof job.bounds.retryMax === 'number',
    `job ${job.id} bounds.retryMax must be number`
  );
  assert.ok(job.idempotency.mechanism, `job ${job.id} missing idempotency.mechanism`);
  assert.ok(job.idempotency.watermark, `job ${job.id} missing idempotency.watermark`);
  assert.ok(
    typeof job.freshness.windowHours === 'number',
    `job ${job.id} freshness.windowHours must be number`
  );
  assert.ok(
    job.failureDestination.durableState,
    `job ${job.id} missing failureDestination.durableState`
  );
  assert.ok(
    Array.isArray(job.acceptedExceptions),
    `job ${job.id} acceptedExceptions must be array`
  );
}

// 3. Every job.workflowFile that points to .github/workflows exists
for (const job of jobsJson.jobs) {
  if (
    job.workflowFile &&
    (job.workflowFile.endsWith('.yml') || job.workflowFile.endsWith('.yaml'))
  ) {
    const exists = await pathExists(join(ROOT, job.workflowFile));
    assert.ok(exists, `job ${job.id} workflowFile does not exist: ${job.workflowFile}`);
  }
}

// 4. Every recurring (schedule or push) workflow in .github/workflows is registered in jobs.json
const registeredWorkflowFiles = new Set(
  jobsJson.jobs.map((j) => j.workflowFile?.split('/').pop()).filter(Boolean)
);
const unregisteredRecurring = [];
for (const wf of workflows) {
  if (registeredWorkflowFiles.has(wf)) continue;
  const content = await readFile(join(WORKFLOWS_DIR, wf), 'utf8');
  const triggers = parseWorkflowTriggers(content);
  if (triggers?.hasSchedule || triggers?.hasPush) {
    unregisteredRecurring.push(wf);
  }
}
assert.deepEqual(
  unregisteredRecurring,
  [],
  `recurring workflows missing from jobs.json: ${unregisteredRecurring.join(', ')}`
);

// 5. Every lifecycle table referenced in jobs.json exists in the D1 schema
for (const job of jobsJson.jobs) {
  for (const field of ['lifecycleTable', 'rawEventTable', 'llmAuditTable']) {
    const value = job.evidence?.[field];
    if (!value) continue;
    for (let part of String(value).split(',')) {
      part = part.replace(/\([^)]*\)/g, '').trim();
      if (!part || !/^[a-z_][a-z_0-9]*$/.test(part)) continue;
      assert.ok(
        schemaTables.has(part),
        `job ${job.id} evidence.${field} references unknown table: ${part}`
      );
    }
  }
}

// 6. Job ids are unique
const jobIds = jobsJson.jobs.map((j) => j.id);
assert.equal(new Set(jobIds).size, jobIds.length, 'job ids must be unique');

// 7. Surface ids are unique
const surfaceIds = jobsJson.surfaces.map((s) => s.id);
assert.equal(new Set(surfaceIds).size, surfaceIds.length, 'surface ids must be unique');

// 8. The coverage audit script itself runs green (no blocking gaps)
const auditResult = await runCoverageAudit();
assert.equal(
  auditResult.code,
  0,
  `automation-coverage.mjs should exit 0 (no blocking gaps). stderr: ${auditResult.err}`
);

console.log('automation-coverage.test.mjs: ok');
