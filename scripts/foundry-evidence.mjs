#!/usr/bin/env node
// foundry-evidence.mjs — produces a sanitized Foundry evidence snapshot
// aggregating job lifecycle, API health, freshness, cost, product funnel,
// and data durability into reports/foundry-evidence/<date>.json.
//
// Read-only. No production mutation. No secrets. No raw prompts/content.
//
// Inputs (all optional — the snapshot degrades gracefully to "blocked" status
// when an evidence source is unavailable):
//   - API_BASE + ADMIN_TOKEN env vars → /health, /admin/audit/summary
//   - Local git artifacts (jobs.json, daily-source-refreshes.json, etc.)
//   - git log for artifact freshness
//
// Sanitization guarantees (tested in foundry-evidence.test.mjs):
//   - No string matching credential patterns is persisted.
//   - No event content, signal body, or LLM prompt/response body is included.
//   - Only aggregate counts, model names, latency, token counts, and status
//     strings are recorded.

import { readFile, readdir, mkdir, writeFile, access, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JOBS_JSON = resolve(ROOT, 'docs/operations/jobs.json');
const SAFE_ACTIONS_JSON = resolve(ROOT, 'scripts/foundry-safe-actions.json');
const DAILY_REFRESH_JSON = resolve(ROOT, 'apps/web/src/data/daily-source-refreshes.json');
const REPORTS_DIR = resolve(ROOT, 'reports/foundry-evidence');

function fail(msg, code = 2) {
  console.error(`foundry-evidence: ${msg}`);
  process.exit(code);
}

async function readJson(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
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

async function artifactMtimeMs(path) {
  try {
    const st = await stat(path);
    return st.mtimeMs;
  } catch {
    return null;
  }
}

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

// HTTP GET with a short timeout. Returns { ok, status, json } or { ok: false, error }.
async function httpGet(url, headers = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: r.ok, status: r.status, json };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Aggregate product funnel evidence from the bundled daily-source-refreshes
// artifact (no network required). This is the same source as
// buildDailyAutomationStatus in apps/web/src/lib/daily-intelligence.ts.
async function productFunnelEvidence() {
  const records = await readJson(DAILY_REFRESH_JSON);
  if (!records || !Array.isArray(records)) {
    return { status: 'blocked', reason: 'daily-source-refreshes.json missing or invalid' };
  }
  const liveRecords = records.filter((r) => !r.seededReplay && !r.replay);
  const accepted = liveRecords.filter((r) => r.digest?.accepted !== false);
  const latestAcceptedAt = accepted
    .map((r) => r.digest?.acceptedAt ?? r.digest?.snapshotDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const latestAcceptedDate = latestAcceptedAt?.slice(0, 10) ?? null;
  const now = Date.now();
  const freshnessHours = latestAcceptedAt
    ? (now - new Date(latestAcceptedAt).getTime()) / 3_600_000
    : null;
  return {
    status: freshnessHours == null ? 'empty' : freshnessHours <= 36 ? 'fresh' : 'stale',
    latestAcceptedDate,
    latestAcceptedAt,
    freshnessHours: freshnessHours == null ? null : Math.round(freshnessHours * 10) / 10,
    observedSnapshots: liveRecords.length,
    acceptedSnapshots: accepted.length,
    rejectedSnapshots: liveRecords.length - accepted.length,
    acquisitionSignal: 'daily-source-refreshes.json acceptedSnapshots (operator-facing)',
    ctaSignal: 'n/a — free product, no billing conversion (accepted exception)',
    activationSignal: 'Clerk sign-in events on /auth (Clerk dashboard — not queried here)',
    returnSignal: 'daily_brief_snapshots daily refresh (queried below if API reachable)',
  };
}

// Aggregate API health + audit summary evidence (requires API_BASE + ADMIN_TOKEN).
async function apiEvidence() {
  const apiBase = process.env.API_BASE;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!apiBase || !adminToken) {
    return {
      status: 'blocked',
      reason: 'API_BASE or ADMIN_TOKEN not set — cannot query live API',
      healthProbe: null,
      auditSummary: null,
    };
  }
  const base = apiBase.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${adminToken}` };
  const health = await httpGet(`${base}/health`);
  // /admin/audit/summary is admin-gated; use the admin token.
  const audit = await httpGet(`${base}/admin/audit/summary?days=7`, headers);
  return {
    status: health.ok && audit.ok ? 'pass' : 'fail',
    healthProbe: { ok: health.ok, status: health.status, ts: health.json?.ts ?? null },
    auditSummary: audit.ok
      ? {
          sinceDays: audit.json?.sinceDays ?? null,
          eventsBySource: audit.json?.eventsBySource ?? [],
          llmRuns: audit.json?.llmRuns ?? [],
          ingestRuns: audit.json?.ingestRuns ?? [],
        }
      : { status: audit.status, error: audit.error ?? 'audit summary unavailable' },
  };
}

// Aggregate cost / provider visibility from /admin/audit/summary llmRuns.
// Records model, accepted count, avg latency — NOT prompt/response bodies.
function costProviderEvidence(apiEvidenceResult) {
  const llmRuns = apiEvidenceResult?.auditSummary?.llmRuns;
  if (!Array.isArray(llmRuns) || llmRuns.length === 0) {
    return {
      status: 'blocked',
      reason: 'no llm_runs aggregate available (API unreachable or no runs in window)',
      models: [],
    };
  }
  const models = llmRuns.map((r) => ({
    model: r.model,
    accepted: Boolean(r.accepted),
    count: r.n,
    avgLatencyMs: r.avg_ms == null ? null : Math.round(r.avg_ms),
  }));
  return {
    status: 'pass',
    models,
    note: 'Aggregate model usage, accepted count, and avg latency only. No prompt/response bodies. No $ cost view (provider policy unchanged — proposal non-goal).',
  };
}

// Aggregate data durability evidence from docs/operations/data-durability.md.
// We do NOT parse the markdown into structured data; we record its presence
// and the count of "Not reconstructable" entries as a soft signal.
async function dataDurabilityEvidence() {
  const docPath = resolve(ROOT, 'docs/operations/data-durability.md');
  if (!(await pathExists(docPath))) {
    return { status: 'blocked', reason: 'docs/operations/data-durability.md missing' };
  }
  const content = await readFile(docPath, 'utf8');
  const nonReconstructable = (content.match(/\*\*Not reconstructable\*\*/g) || []).length;
  const tablesListed = (content.match(/^\| `[a-z_][a-z_0-9]+`/gm) || []).length;
  return {
    status: 'pass',
    docPresent: true,
    tablesListed,
    nonReconstructableEntries: nonReconstructable,
    note: 'Operator must back up D1 before destructive actions on non-reconstructable tables (delivery_*, watchlists_*).',
  };
}

// Aggregate job freshness evidence from local artifacts (no D1 query).
async function jobFreshnessEvidence(jobsJson) {
  const out = [];
  for (const job of jobsJson.jobs ?? []) {
    if (!job.freshness || job.freshness.windowHours <= 0) {
      out.push({ id: job.id, status: 'not-applicable', windowHours: 0 });
      continue;
    }
    let observedAtMs = null;
    if (job.evidence?.lifecycleArtifact) {
      observedAtMs = await artifactMtimeMs(join(ROOT, job.evidence.lifecycleArtifact));
    }
    if (observedAtMs == null) {
      out.push({
        id: job.id,
        status: 'blocked',
        windowHours: job.freshness.windowHours,
        reason: job.evidence?.lifecycleTable
          ? `lifecycle table ${job.evidence.lifecycleTable} requires D1 query (API_BASE/ADMIN_TOKEN not used for per-job freshness in this snapshot)`
          : 'no local lifecycle artifact',
      });
      continue;
    }
    const ageHours = (Date.now() - observedAtMs) / 3_600_000;
    out.push({
      id: job.id,
      status: ageHours <= job.freshness.windowHours ? 'pass' : 'stale',
      windowHours: job.freshness.windowHours,
      ageHours: Math.round(ageHours * 10) / 10,
      observedAtMs,
    });
  }
  return out;
}

// Deployment revision evidence from git log on main.
async function deploymentEvidence() {
  const webSha = await git(['log', '-1', '--format=%H|%cI', '--', 'apps/web']);
  const apiSha = await git(['log', '-1', '--format=%H|%cI', '--', 'workers/api']);
  const split = (s) => (s ? { sha: s.split('|')[0], committedAt: s.split('|')[1] } : null);
  return {
    web: split(webSha),
    api: split(apiSha),
    note: 'Git commit sha on main is the deployment revision evidence. Cloudflare worker revision id is the live probe (not queried here).',
  };
}

// Sanitization: redact credential-shaped strings, drop any field named
// requestJson/responseJson/content/prompt/body/rawText, and clamp long strings.
const REDACT_RE = /(sk-[a-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{16,}|[A-Za-z0-9_-]{40,})/gi;
const FORBIDDEN_KEYS = new Set([
  'requestJson',
  'responseJson',
  'request_json',
  'response_json',
  'content',
  'body',
  'prompt',
  'rawText',
  'raw_text',
  'rawJson',
  'raw_json',
  'errorSample',
  'error_sample',
]);

function sanitize(value, key = null) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (key && FORBIDDEN_KEYS.has(key)) return '[omitted]';
    if (value.length > 500) return value.slice(0, 500) + '…[truncated]';
    if (REDACT_RE.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = sanitize(v, k);
    }
    return out;
  }
  return value;
}

async function main() {
  const jobsJson = await readJson(JOBS_JSON);
  if (!jobsJson) fail('docs/operations/jobs.json missing or invalid', 1);
  const safeActions = await readJson(SAFE_ACTIONS_JSON);
  if (!safeActions) fail('scripts/foundry-safe-actions.json missing or invalid', 1);

  const productFunnel = await productFunnelEvidence();
  const api = await apiEvidence();
  const cost = costProviderEvidence(api);
  const durability = await dataDurabilityEvidence();
  const jobFreshness = await jobFreshnessEvidence(jobsJson);
  const deployment = await deploymentEvidence();

  // Foundry action policy summary (no secrets; just counts).
  const actionPolicy = {
    safeActionsCount: safeActions.safeActions?.length ?? 0,
    forbiddenActionsCount: safeActions.forbiddenActions?.length ?? 0,
    executeSafeCount: (safeActions.safeActions ?? []).filter(
      (a) => a.actionLevel === 'execute-safe'
    ).length,
    observeCount: (safeActions.safeActions ?? []).filter((a) => a.actionLevel === 'observe').length,
    policy: safeActions.policy?.description ?? null,
  };

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = {
    project: jobsJson.project,
    date,
    generatedAt: new Date().toISOString(),
    inventoryVersion: jobsJson.version,
    productFunnel,
    api,
    costProvider: cost,
    dataDurability: durability,
    jobFreshness,
    deployment,
    actionPolicy,
  };

  const sanitized = sanitize(snapshot);
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(join(REPORTS_DIR, `${date}.json`), JSON.stringify(sanitized, null, 2) + '\n');

  console.log(`foundry-evidence: wrote reports/foundry-evidence/${date}.json`);
  console.log(`  productFunnel: ${productFunnel.status}`);
  console.log(`  api: ${api.status}`);
  console.log(`  costProvider: ${cost.status}`);
  console.log(`  dataDurability: ${durability.status}`);
  console.log(
    `  jobFreshness: ${jobFreshness.filter((j) => j.status === 'pass').length}/${jobFreshness.length} pass`
  );
  console.log(
    `  actionPolicy: ${actionPolicy.safeActionsCount} safe, ${actionPolicy.forbiddenActionsCount} forbidden`
  );
}

main().catch((err) => fail(`unexpected error: ${err?.stack || err}`, 2));
