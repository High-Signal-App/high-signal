#!/usr/bin/env node
// foundry-safe-actions.test.mjs — validates the Foundry safe-action registry:
//   - safeActions are idempotent and have verification commands
//   - forbiddenActions are NOT present in safeActions
//   - no safeAction has actionLevel "approve-required" (those are human gates)
//   - editorial/ranking/source/schema/deploy/credential mutations are forbidden
// Run: node scripts/foundry-safe-actions.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SAFE_ACTIONS_JSON = resolve(ROOT, 'scripts/foundry-safe-actions.json');

const registry = JSON.parse(await readFile(SAFE_ACTIONS_JSON, 'utf8'));

// 1. Top-level shape
assert.ok(registry.policy, 'registry must have a policy');
assert.ok(Array.isArray(registry.policy.actionLevels), 'policy.actionLevels must be array');
assert.ok(
  registry.policy.executeSafeRequiresRegistryEntry,
  'policy must require registry entry for execute-safe'
);
assert.ok(Array.isArray(registry.safeActions), 'safeActions must be array');
assert.ok(Array.isArray(registry.forbiddenActions), 'forbiddenActions must be array');

// 2. Every safeAction has the required fields
for (const a of registry.safeActions) {
  assert.ok(a.id, `safeAction missing id: ${JSON.stringify(a)}`);
  assert.ok(a.actionLevel, `safeAction ${a.id} missing actionLevel`);
  assert.ok(
    ['observe', 'execute-safe'].includes(a.actionLevel),
    `safeAction ${a.id} actionLevel must be observe or execute-safe (not approve-required)`
  );
  assert.ok(a.command, `safeAction ${a.id} missing command`);
  assert.ok(a.idempotency, `safeAction ${a.id} missing idempotency`);
  assert.ok(a.verification, `safeAction ${a.id} missing verification`);
  assert.ok(typeof a.maxRetries === 'number', `safeAction ${a.id} missing maxRetries`);
  assert.equal(
    a.requiresApproval,
    false,
    `safeAction ${a.id} must not require approval (else it's not safe)`
  );
}

// 3. No safeAction command matches a forbidden pattern
const FORBIDDEN_COMMAND_PATTERNS = [
  /db:migrate:remote/,
  /deploy-web\.yml/,
  /deploy-api\.yml/,
  /gh secret/,
  /wrangler secret/,
  /DELETE\s+FROM/i,
  /UPDATE\s+.*\s+SET/i,
  /signals\/.*\.md.*--amend/,
  /git\s+push\s+--force/,
  /gh\s+workflow\s+run\s+deploy/,
];

for (const a of registry.safeActions) {
  for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
    assert.ok(
      !pattern.test(a.command),
      `safeAction ${a.id} command matches forbidden pattern ${pattern}: ${a.command}`
    );
  }
}

// 4. forbiddenActions cover the spec's mandatory exclusions
const forbiddenIds = new Set(registry.forbiddenActions.map((f) => f.id));
const REQUIRED_FORBIDDEN = [
  'editorial-claim-change',
  'ranking-change',
  'add-source',
  'rate-limit-change',
  'schema-migration',
  'production-deploy',
  'credential-change',
  'data-mutation',
  'public-claim',
];
for (const id of REQUIRED_FORBIDDEN) {
  assert.ok(forbiddenIds.has(id), `forbiddenActions missing required entry: ${id}`);
}

// 5. No forbiddenAction id appears in safeActions (negative test for the spec
// scenario: "Foundry MUST NOT change editorial claims, ranking, sources, rate
// limits, data schemas, or production deployment without approval")
const safeIds = new Set(registry.safeActions.map((a) => a.id));
for (const f of registry.forbiddenActions) {
  assert.ok(!safeIds.has(f.id), `forbidden action ${f.id} must not appear in safeActions`);
}

// 6. Every forbiddenAction has a reason and a correctProcess
for (const f of registry.forbiddenActions) {
  assert.ok(f.reason, `forbiddenAction ${f.id} missing reason`);
  assert.ok(f.correctProcess, `forbiddenAction ${f.id} missing correctProcess`);
}

// 7. execute-safe actions must declare idempotency mechanism + maxRetries > 0
for (const a of registry.safeActions.filter((a) => a.actionLevel === 'execute-safe')) {
  assert.ok(
    typeof a.idempotency === 'string' && a.idempotency.length > 0,
    `execute-safe action ${a.id} must declare idempotency`
  );
  assert.ok(a.maxRetries >= 1, `execute-safe action ${a.id} must allow at least 1 retry`);
}

console.log('foundry-safe-actions.test.mjs: ok');
