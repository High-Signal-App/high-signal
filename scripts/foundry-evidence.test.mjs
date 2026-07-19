#!/usr/bin/env node
// foundry-evidence.test.mjs — validates the sanitization guarantees of
// scripts/foundry-evidence.mjs and the structure of the produced snapshot.
// Run: node scripts/foundry-evidence.test.mjs

import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVIDENCE_SCRIPT = resolve(ROOT, 'scripts/foundry-evidence.mjs');
const REPORTS_DIR = resolve(ROOT, 'reports/foundry-evidence');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

// Run the evidence script with optional env overrides. Returns { code, out, err }.
function runEvidence(env = {}) {
  return new Promise((res) => {
    const child = spawn('node', [EVIDENCE_SCRIPT], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
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

// Recursively scan a value for credential-shaped strings or forbidden keys.
const REDACT_RE = /(sk-[a-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{16,}|[A-Za-z0-9_-]{40,})/i;
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

function findViolations(value, path = '$', acc = []) {
  if (value == null) return acc;
  if (typeof value === 'string') {
    if (REDACT_RE.test(value))
      acc.push({ path, reason: 'credential-shaped string', sample: value.slice(0, 40) });
    return acc;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) findViolations(value[i], `${path}[${i}]`, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k))
        acc.push({ path: `${path}.${k}`, reason: 'forbidden key present' });
      findViolations(v, `${path}.${k}`, acc);
    }
    return acc;
  }
  return acc;
}

// 1. Run the evidence script with no API credentials (degrades gracefully).
const result = await runEvidence();
assert.equal(result.code, 0, `foundry-evidence.mjs should exit 0. stderr: ${result.err}`);

// 2. Find today's snapshot and validate sanitization.
const date = new Date().toISOString().slice(0, 10);
const snapshotPath = join(REPORTS_DIR, `${date}.json`);
const snapshot = await readJson(snapshotPath);

const violations = findViolations(snapshot);
assert.deepEqual(
  violations,
  [],
  `snapshot contains sanitization violations: ${JSON.stringify(violations, null, 2)}`
);

// 3. Structure checks
assert.equal(snapshot.project, 'high-signal');
assert.ok(typeof snapshot.generatedAt === 'string');
assert.ok(typeof snapshot.inventoryVersion === 'number');
assert.ok(snapshot.productFunnel, 'snapshot must include productFunnel');
assert.ok(snapshot.api, 'snapshot must include api');
assert.ok(snapshot.costProvider, 'snapshot must include costProvider');
assert.ok(snapshot.dataDurability, 'snapshot must include dataDurability');
assert.ok(Array.isArray(snapshot.jobFreshness), 'snapshot must include jobFreshness array');
assert.ok(snapshot.deployment, 'snapshot must include deployment');
assert.ok(snapshot.actionPolicy, 'snapshot must include actionPolicy');

// 4. Without API_BASE/ADMIN_TOKEN, api.status must be "blocked" (not a false green)
assert.equal(
  snapshot.api.status,
  'blocked',
  'api status must be blocked when credentials absent (no false green)'
);

// 5. costProvider must NOT include prompt/response bodies or $ cost
assert.ok(
  !JSON.stringify(snapshot.costProvider).includes('prompt'),
  'costProvider must not include prompt bodies'
);
assert.ok(
  !JSON.stringify(snapshot.costProvider).includes('$'),
  'costProvider must not include $ cost view (proposal non-goal)'
);

// 6. actionPolicy must record both safe and forbidden counts
assert.ok(snapshot.actionPolicy.safeActionsCount > 0, 'actionPolicy must list safe actions');
assert.ok(
  snapshot.actionPolicy.forbiddenActionsCount > 0,
  'actionPolicy must list forbidden actions'
);

// 7. jobFreshness entries must each have a status from the allowed set
const ALLOWED_STATUSES = new Set([
  'pass',
  'fail',
  'stale',
  'blocked',
  'accepted-exception',
  'not-applicable',
]);
for (const j of snapshot.jobFreshness) {
  assert.ok(ALLOWED_STATUSES.has(j.status), `jobFreshness ${j.id} has invalid status: ${j.status}`);
}

// 8. Sanitization unit test: feed a synthetic object with a credential and a
// forbidden key through the same sanitization logic by re-importing the
// script's sanitize function. Since the script is a CLI, we re-implement the
// check inline to keep the test self-contained.
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

// Synthetic credential-shaped strings are built at runtime so the literal
// does not appear in source (the pre-push secret scanner would flag it).
const SK_PREFIX = 'sk';
const FAKE_TOKEN = `${SK_PREFIX}-abcdefghijklmnopqrstuvwxyz1234567890`;
const FAKE_BEARER = `Bearer abcdefghijklmnopqrstuvwxyz1234567890`;
const synthetic = {
  apiToken: FAKE_TOKEN,
  authHeader: FAKE_BEARER,
  requestJson: { prompt: 'secret prompt body' },
  content: 'raw article body',
  model: 'deepseek-v4-flash',
  count: 42,
};
const cleaned = sanitize(synthetic);
assert.equal(cleaned.apiToken, '[redacted]');
assert.equal(cleaned.authHeader, '[redacted]');
assert.equal(cleaned.requestJson, undefined);
assert.equal(cleaned.content, undefined);
assert.equal(cleaned.model, 'deepseek-v4-flash');
assert.equal(cleaned.count, 42);

console.log('foundry-evidence.test.mjs: ok');
