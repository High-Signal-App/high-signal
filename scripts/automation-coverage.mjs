#!/usr/bin/env node
// automation-coverage.mjs — validates docs/operations/jobs.json against the
// actual workflow files and D1 schema, then writes a sanitized coverage report
// to reports/automation-coverage/<date>.{json,md}.
//
// Read-only. No production mutation. No secrets. No network calls required
// (uses local artifacts; optional API_BASE + ADMIN_TOKEN for live freshness
// evidence, but never prints or persists credentials).
//
// Exit codes:
//   0 — coverage audit green (every required contract has a status; no
//       unexplained blocking gaps)
//   1 — blocking gap discovered (a recurring path is missing from the
//       inventory, or a registered job names a workflow/table that does not
//       exist)
//   2 — usage / IO error

import { readFile, readdir, mkdir, writeFile, access, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JOBS_JSON = resolve(ROOT, 'docs/operations/jobs.json');
const WORKFLOWS_DIR = resolve(ROOT, '.github/workflows');
const SCHEMA_FILE = resolve(ROOT, 'packages/db/src/schema.ts');
const DURABILITY_DOC = resolve(ROOT, 'docs/operations/data-durability.md');
const REPORTS_DIR = resolve(ROOT, 'reports/automation-coverage');

const FRESHNESS_OK_HOURS_DEFAULT = 30;

function fail(msg, code = 2) {
  console.error(`automation-coverage: ${msg}`);
  process.exit(code);
}

async function readJson(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    fail(`failed to read ${path}: ${err.message}`, 2);
  }
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

async function readWorkflow(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    return null;
  }
}

// Extract cron schedule + timeout-minutes from a workflow file (best-effort).
function parseWorkflowMeta(content) {
  if (!content) return null;
  const cronMatch = content.match(/cron:\s*["'`]([^"'`]+)["'`]/);
  const timeoutMatch = content.match(/timeout-minutes:\s*(\d+)/);
  const hasSchedule = /^\s*schedule:\s*$/m.test(content);
  const hasWorkflowDispatch = /workflow_dispatch:/.test(content);
  const hasPush = /^\s*push:/m.test(content);
  return {
    cron: cronMatch ? cronMatch[1] : null,
    hasSchedule,
    hasWorkflowDispatch,
    hasPush,
    timeoutMinutes: timeoutMatch ? Number(timeoutMatch[1]) : null,
  };
}

// Extract declared sqlite tables from schema.ts (best-effort).
async function parseSchemaTables() {
  const content = await readFile(SCHEMA_FILE, 'utf8');
  const tables = new Set();
  for (const m of content.matchAll(/sqliteTable\(\s*["'`]([a-z_0-9]+)["'`]/g)) {
    tables.add(m[1]);
  }
  return tables;
}

// Extract tables referenced in data-durability.md (best-effort).
async function parseDurabilityTables() {
  if (!(await pathExists(DURABILITY_DOC))) return new Set();
  const content = await readFile(DURABILITY_DOC, 'utf8');
  const tables = new Set();
  for (const m of content.matchAll(/`([a-z_][a-z_0-9]+)`/g)) {
    // Filter to plausible table names (snake_case, not common words).
    if (/^[a-z_][a-z_0-9]*$/.test(m[1]) && m[1].length >= 4) {
      tables.add(m[1]);
    }
  }
  return tables;
}

function statusForFreshness(observedAtMs, windowHours, nowMs = Date.now()) {
  if (observedAtMs == null) return 'stale';
  const ageHours = (nowMs - observedAtMs) / 3_600_000;
  if (ageHours <= windowHours) return 'pass';
  return 'stale';
}

// Run a git command and return stdout (best-effort; returns null on failure).
function git(args) {
  return new Promise((res) => {
    const child = spawn('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => res(null));
    child.on('close', () => res(out.trim() || null));
  });
}

async function artifactMtimeMs(path) {
  try {
    const st = await stat(path);
    return st.mtimeMs;
  } catch {
    return null;
  }
}

async function evaluateJob(job, ctx) {
  const findings = [];
  // 1. workflowFile exists
  if (job.workflowFile && !job.workflowFile.includes('wrangler.toml')) {
    const wfPath = join(ROOT, job.workflowFile);
    if (!(await pathExists(wfPath))) {
      findings.push({
        severity: 'blocking',
        contract: 'workflowFile-exists',
        message: `workflow file not found: ${job.workflowFile}`,
      });
    } else if (job.workflowFile.endsWith('.yml') || job.workflowFile.endsWith('.yaml')) {
      const wfName = job.workflowFile.split('/').pop();
      if (!ctx.workflows.includes(wfName)) {
        findings.push({
          severity: 'blocking',
          contract: 'workflowFile-registered-in-dir',
          message: `workflow file present but not listed in .github/workflows/: ${wfName}`,
        });
      }
    }
  }
  // 2. lifecycle evidence table exists in schema (if declared).
  // The lifecycleTable field may list multiple tables, optionally with
  // parenthetical column hints, e.g. "signals (review_status, published_at)"
  // or "events, ingest_runs". Split on commas and strip parentheticals.
  const evidenceTables = [];
  const pushTables = (field) => {
    if (!field) return;
    for (let part of String(field).split(',')) {
      part = part.replace(/\([^)]*\)/g, '').trim();
      if (part && /^[a-z_][a-z_0-9]*$/.test(part)) evidenceTables.push(part);
    }
  };
  pushTables(job.evidence?.lifecycleTable);
  pushTables(job.evidence?.rawEventTable);
  pushTables(job.evidence?.llmAuditTable);
  for (const t of evidenceTables) {
    if (!ctx.schemaTables.has(t)) {
      findings.push({
        severity: 'blocking',
        contract: 'lifecycle-table-in-schema',
        message: `job ${job.id} declares lifecycle table ${t} but it is not in packages/db/src/schema.ts`,
      });
    }
  }
  // 3. bounds declared
  if (!job.bounds || typeof job.bounds.timeoutMinutes !== 'number') {
    findings.push({
      severity: 'blocking',
      contract: 'bounds-timeout',
      message: `job ${job.id} missing bounds.timeoutMinutes`,
    });
  }
  if (!job.bounds || typeof job.bounds.concurrency !== 'number') {
    findings.push({
      severity: 'blocking',
      contract: 'bounds-concurrency',
      message: `job ${job.id} missing bounds.concurrency`,
    });
  }
  if (!job.bounds || typeof job.bounds.retryMax !== 'number') {
    findings.push({
      severity: 'blocking',
      contract: 'bounds-retryMax',
      message: `job ${job.id} missing bounds.retryMax`,
    });
  }
  // 4. idempotency declared
  if (!job.idempotency || !job.idempotency.mechanism || !job.idempotency.watermark) {
    findings.push({
      severity: 'blocking',
      contract: 'idempotency-declared',
      message: `job ${job.id} missing idempotency.mechanism or .watermark`,
    });
  }
  // 5. freshness declared
  if (!job.freshness || typeof job.freshness.windowHours !== 'number') {
    findings.push({
      severity: 'blocking',
      contract: 'freshness-declared',
      message: `job ${job.id} missing freshness.windowHours`,
    });
  }
  // 6. failure destination declared
  if (!job.failureDestination || !job.failureDestination.durableState) {
    findings.push({
      severity: 'blocking',
      contract: 'failure-destination-declared',
      message: `job ${job.id} missing failureDestination.durableState`,
    });
  }
  // 7. freshness status (best-effort, local artifacts only)
  let freshnessStatus = 'not-applicable';
  let observedAt = null;
  if (job.freshness && job.freshness.windowHours > 0) {
    if (job.evidence?.lifecycleArtifact) {
      observedAt = await artifactMtimeMs(join(ROOT, job.evidence.lifecycleArtifact));
    } else if (job.evidence?.lifecycleTable && job.evidence.lifecycleTable !== 'n/a') {
      // Cannot query D1 without credentials; mark as blocked (not stale) so
      // the report does not claim freshness it cannot prove.
      freshnessStatus = 'blocked';
    }
    if (observedAt != null) {
      freshnessStatus = statusForFreshness(observedAt, job.freshness.windowHours);
    } else if (freshnessStatus === 'not-applicable') {
      freshnessStatus = 'blocked';
    }
  }
  // 8. accepted exceptions are strings
  if (job.acceptedExceptions && !Array.isArray(job.acceptedExceptions)) {
    findings.push({
      severity: 'blocking',
      contract: 'accepted-exceptions-shape',
      message: `job ${job.id} acceptedExceptions must be an array of strings`,
    });
  }
  return {
    id: job.id,
    kind: job.kind,
    trigger: job.trigger,
    bounds: job.bounds,
    freshness: { ...job.freshness, status: freshnessStatus, observedAtMs: observedAt },
    findings,
    acceptedExceptions: job.acceptedExceptions ?? [],
  };
}

async function evaluateSurface(surface, ctx) {
  const findings = [];
  if (!surface.canonicalLiveProbe) {
    findings.push({
      severity: 'blocking',
      contract: 'canonical-live-probe',
      message: `surface ${surface.id} missing canonicalLiveProbe`,
    });
  }
  if (!surface.buildEvidence) {
    findings.push({
      severity: 'blocking',
      contract: 'build-evidence',
      message: `surface ${surface.id} missing buildEvidence`,
    });
  }
  // Product funnel signals are required for public-surface runtimes only.
  // API/Worker runtimes have a different contract (healthProbe, structured
  // request logs, latency/error, deployment, cost) per the umbrella spec.
  if (surface.kind === 'public-surface') {
    for (const key of ['acquisitionSignal', 'returnSignal']) {
      if (!surface[key]) {
        findings.push({
          severity: 'blocking',
          contract: `product-${key}`,
          message: `surface ${surface.id} missing ${key}`,
        });
      }
    }
  }
  if (surface.kind === 'api-worker') {
    for (const key of [
      'healthProbe',
      'structuredRequestLogs',
      'latencyErrorSignal',
      'deploymentEvidence',
    ]) {
      if (!surface[key]) {
        findings.push({
          severity: 'blocking',
          contract: `api-${key}`,
          message: `surface ${surface.id} missing ${key}`,
        });
      }
    }
  }
  if (!surface.acceptedExceptions || !Array.isArray(surface.acceptedExceptions)) {
    findings.push({
      severity: 'blocking',
      contract: 'accepted-exceptions-shape',
      message: `surface ${surface.id} acceptedExceptions must be an array`,
    });
  }
  return {
    id: surface.id,
    kind: surface.kind,
    findings,
    acceptedExceptions: surface.acceptedExceptions ?? [],
  };
}

// Discover any cron workflow in .github/workflows that is NOT in jobs.json —
// that is an unregistered recurring path (blocking gap per spec).
async function findUnregisteredWorkflows(jobs) {
  const registered = new Set(jobs.map((j) => j.workflowFile?.split('/').pop()).filter(Boolean));
  const workflows = await listWorkflows();
  const unregistered = [];
  for (const wf of workflows) {
    if (registered.has(wf)) continue;
    const content = await readWorkflow(join(WORKFLOWS_DIR, wf));
    if (!content) continue;
    // Skip workflows that are not recurring (no schedule, no push, no workflow_dispatch
    // is impossible — workflow_dispatch alone is on-demand, not recurring).
    // We treat "schedule" as the recurring signal. push and workflow_dispatch
    // are also registered (deploy workflows, backfill) so they appear in jobs.json.
    const meta = parseWorkflowMeta(content);
    if (meta?.hasSchedule || meta?.hasPush) {
      // Recurring or auto-on-push — must be registered.
      unregistered.push(wf);
    } else if (meta?.hasWorkflowDispatch && !meta?.hasSchedule && !meta?.hasPush) {
      // On-demand only — registered if it appears in jobs.json (backfill, deploy).
      // If not registered, that's a soft finding (not blocking) — on-demand jobs
      // don't have a freshness contract.
      // No-op here; we only flag recurring/auto-triggered workflows.
    }
  }
  return unregistered;
}

function sanitizeReport(obj) {
  // Defensive: redact any string that looks like a credential before writing.
  const credRe = /(sk-[a-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{16,}|[A-Za-z0-9_-]{32,})/gi;
  const seen = new WeakSet();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (credRe.test(v)) return '[redacted]';
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (seen.has(v)) return v;
      seen.add(v);
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(obj);
}

function summarize(results) {
  const counts = {
    pass: 0,
    fail: 0,
    stale: 0,
    blocked: 0,
    'accepted-exception': 0,
    'not-applicable': 0,
  };
  let blocking = 0;
  for (const r of results.jobs) {
    if (r.freshness.status in counts) counts[r.freshness.status]++;
    blocking += r.findings.filter((f) => f.severity === 'blocking').length;
  }
  for (const s of results.surfaces) {
    blocking += s.findings.filter((f) => f.severity === 'blocking').length;
  }
  blocking += results.unregisteredWorkflows.length;
  return { counts, blocking };
}

function renderMarkdown(report, summary) {
  const lines = [];
  lines.push(`# Automation coverage report — ${report.date}`);
  lines.push('');
  lines.push(`> Generated by \`scripts/automation-coverage.mjs\`. Read-only. No secrets.`);
  lines.push('');
  lines.push(`**Project:** ${report.project}`);
  lines.push(`**Generated at:** ${report.generatedAt}`);
  lines.push(`**Blocking gaps:** ${summary.blocking}`);
  lines.push('');
  lines.push('## Job inventory');
  lines.push('');
  lines.push(
    '| Job | Kind | Trigger | Timeout | Concurrency | RetryMax | Freshness | Status | Blocking findings |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const j of report.results.jobs) {
    const blocking = j.findings.filter((f) => f.severity === 'blocking').length;
    lines.push(
      `| ${j.id} | ${j.kind} | ${j.trigger?.cron ?? j.trigger?.type} | ${j.bounds?.timeoutMinutes ?? '-'}m | ${j.bounds?.concurrency ?? '-'} | ${j.bounds?.retryMax ?? '-'} | ${j.freshness?.windowHours ?? '-'}h | ${j.freshness?.status} | ${blocking} |`
    );
  }
  lines.push('');
  lines.push('## Surfaces');
  lines.push('');
  lines.push('| Surface | Kind | Blocking findings | Accepted exceptions |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of report.results.surfaces) {
    const blocking = s.findings.filter((f) => f.severity === 'blocking').length;
    lines.push(`| ${s.id} | ${s.kind} | ${blocking} | ${s.acceptedExceptions.length} |`);
  }
  lines.push('');
  if (report.results.unregisteredWorkflows.length > 0) {
    lines.push('## Unregistered recurring workflows (blocking)');
    lines.push('');
    for (const w of report.results.unregisteredWorkflows)
      lines.push(`- \`.github/workflows/${w}\``);
    lines.push('');
  }
  lines.push('## Blocking findings');
  lines.push('');
  if (summary.blocking === 0) {
    lines.push(
      '_None._ Every required contract has a status; accepted exceptions are named per job/surface.'
    );
  } else {
    for (const j of report.results.jobs) {
      for (const f of j.findings) {
        if (f.severity === 'blocking') lines.push(`- [${j.id}] ${f.contract}: ${f.message}`);
      }
    }
    for (const s of report.results.surfaces) {
      for (const f of s.findings) {
        if (f.severity === 'blocking') lines.push(`- [${s.id}] ${f.contract}: ${f.message}`);
      }
    }
    for (const w of report.results.unregisteredWorkflows) {
      lines.push(
        `- [unregistered] recurring-workflow: .github/workflows/${w} has a schedule/push trigger but no jobs.json entry`
      );
    }
  }
  lines.push('');
  lines.push('## Accepted exceptions');
  lines.push('');
  for (const j of report.results.jobs) {
    for (const e of j.acceptedExceptions) lines.push(`- [${j.id}] ${e}`);
  }
  for (const s of report.results.surfaces) {
    for (const e of s.acceptedExceptions) lines.push(`- [${s.id}] ${e}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const jobsJson = await readJson(JOBS_JSON);
  if (!jobsJson.jobs || !Array.isArray(jobsJson.jobs)) fail('jobs.json missing jobs array', 1);
  if (!jobsJson.surfaces || !Array.isArray(jobsJson.surfaces))
    fail('jobs.json missing surfaces array', 1);

  const workflows = await listWorkflows();
  const schemaTables = await parseSchemaTables();
  const durabilityTables = await parseDurabilityTables();
  const ctx = { workflows, schemaTables, durabilityTables };

  const jobResults = [];
  for (const job of jobsJson.jobs) jobResults.push(await evaluateJob(job, ctx));

  const surfaceResults = [];
  for (const s of jobsJson.surfaces) surfaceResults.push(await evaluateSurface(s, ctx));

  const unregistered = await findUnregisteredWorkflows(jobsJson.jobs);

  // Cross-check: every table referenced in data-durability.md should exist in
  // schema.ts (soft finding — not blocking, since the doc may reference parked
  // tables or future migrations).
  const durabilityOnly = [...durabilityTables].filter((t) => !schemaTables.has(t));

  const results = {
    jobs: jobResults,
    surfaces: surfaceResults,
    unregisteredWorkflows: unregistered,
    durabilityOnlyTables: [...durabilityOnly],
  };
  const summary = summarize(results);

  const date = new Date().toISOString().slice(0, 10);
  const report = {
    project: jobsJson.project,
    date,
    generatedAt: new Date().toISOString(),
    inventoryVersion: jobsJson.version,
    results,
    summary,
  };

  await mkdir(REPORTS_DIR, { recursive: true });
  const sanitized = sanitizeReport(report);
  await writeFile(join(REPORTS_DIR, `${date}.json`), JSON.stringify(sanitized, null, 2) + '\n');
  await writeFile(join(REPORTS_DIR, `${date}.md`), renderMarkdown(sanitized, summary));

  console.log(`automation-coverage: wrote reports/automation-coverage/${date}.json + .md`);
  console.log(`  jobs: ${jobResults.length}, surfaces: ${surfaceResults.length}`);
  console.log(`  blocking gaps: ${summary.blocking}`);
  if (summary.blocking > 0) {
    console.error('automation-coverage: blocking gaps discovered — see report');
    process.exit(1);
  }
}

main().catch((err) => fail(`unexpected error: ${err?.stack || err}`, 2));
