#!/usr/bin/env tsx
/**
 * Unit tests for the single-operator admin session (the Clerk replacement).
 *
 * Run: `node_modules/.bin/tsx scripts/admin-session.test.ts`
 *
 * No vitest dependency — uses the in-tree tiny-runner pattern that the rest
 * of `scripts/*.test.ts` uses (auto-publish-rules.test.ts, daily-range.test.ts).
 *
 * The module under test is deliberately free of `next/*` imports so it loads
 * here; the request-bound gate lives in apps/web/src/lib/admin-guard.ts.
 */

import {
  SESSION_TTL_MS,
  checkPassword,
  isValidSessionValue,
  mintSessionValue,
  parseCookie,
} from '../apps/web/src/lib/admin-session';

let total = 0;
let failures = 0;

function checkBool(name: string, actual: boolean, expected: boolean) {
  total += 1;
  if (actual === expected) return;
  failures += 1;
  console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`);
}

const NOW = 1_700_000_000_000;

async function main() {
  // --- fails closed with no secret configured -----------------------------
  delete process.env['ADMIN_SESSION_SECRET'];
  delete process.env['ADMIN_PASSWORD'];

  checkBool('mint returns null without a secret', (await mintSessionValue(NOW)) === null, true);
  checkBool('verify false without a secret', await isValidSessionValue('1.abc', NOW), false);
  checkBool('password false without a secret', await checkPassword('anything'), false);

  // --- configured ---------------------------------------------------------
  process.env['ADMIN_SESSION_SECRET'] = 'test-session-secret';
  process.env['ADMIN_PASSWORD'] = 'correct horse battery staple';

  const value = await mintSessionValue(NOW);
  checkBool('mint returns a value once configured', typeof value === 'string', true);
  checkBool('minted session verifies', await isValidSessionValue(value ?? '', NOW), true);

  // --- expiry -------------------------------------------------------------
  checkBool(
    'session valid just before expiry',
    await isValidSessionValue(value ?? '', NOW + SESSION_TTL_MS - 1000),
    true
  );
  checkBool(
    'session rejected after expiry',
    await isValidSessionValue(value ?? '', NOW + SESSION_TTL_MS + 1000),
    false
  );

  // --- tampering ----------------------------------------------------------
  const [expiry, signature] = (value ?? '').split('.');
  checkBool(
    'tampered signature rejected',
    await isValidSessionValue(`${expiry}.${'0'.repeat(signature.length)}`, NOW),
    false
  );
  checkBool(
    'extended expiry rejected (signature covers expiry)',
    await isValidSessionValue(`${Number(expiry) + 86_400_000}.${signature}`, NOW),
    false
  );
  checkBool('malformed value rejected', await isValidSessionValue('not-a-session', NOW), false);
  checkBool('empty value rejected', await isValidSessionValue('', NOW), false);
  checkBool('undefined value rejected', await isValidSessionValue(undefined, NOW), false);

  // --- a different secret cannot forge ------------------------------------
  process.env['ADMIN_SESSION_SECRET'] = 'a-different-secret';
  checkBool(
    'session from another secret rejected',
    await isValidSessionValue(value ?? '', NOW),
    false
  );
  process.env['ADMIN_SESSION_SECRET'] = 'test-session-secret';

  // --- password -----------------------------------------------------------
  checkBool('correct password accepted', await checkPassword('correct horse battery staple'), true);
  checkBool('wrong password rejected', await checkPassword('hunter2'), false);
  checkBool('empty password rejected', await checkPassword(''), false);
  checkBool('prefix of password rejected', await checkPassword('correct horse'), false);

  // --- cookie parsing -----------------------------------------------------
  checkBool(
    'parses the target cookie among several',
    parseCookie('other=1; hs_admin=abc.def; trailing=2', 'hs_admin') === 'abc.def',
    true
  );
  checkBool(
    'returns undefined when absent',
    parseCookie('other=1', 'hs_admin') === undefined,
    true
  );
  checkBool('returns undefined for null header', parseCookie(null, 'hs_admin') === undefined, true);
  checkBool(
    'does not match a cookie by suffix',
    parseCookie('not_hs_admin=nope', 'hs_admin') === undefined,
    true
  );

  console.log(`\nadmin-session.test.ts: ${total - failures}/${total} passed`);
  if (failures > 0) {
    console.error(
      `admin-session.test.ts: FAILED (${failures} failure${failures === 1 ? '' : 's'})`
    );
    process.exit(1);
  }
  console.log('admin-session.test.ts: ok');
}

void main();
