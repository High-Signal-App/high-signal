import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReaderRuntime, WEB_ROOT } from './reader-runtime.mjs';

// Real deploy bundle + workerd + persistent local R2. Authorization bypasses
// both the Astro reader and outer cache, so this checks the Next ISR fallback.
const storage = mkdtempSync(join(tmpdir(), 'high-signal-isr-restart-'));
let runtime;
async function readProfile() {
  const response = await runtime.dispatchFetch('https://highsignal.app/case-studies/openai', {
    headers: { authorization: 'Bearer local-cache-test' },
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}
try {
  runtime = await createReaderRuntime(WEB_ROOT, storage);
  const first = await readProfile();
  assert.equal(first.status, 200);
  assert.match(first.body, /data-high-signal-public-cache="company-profile-v1"/);
  assert.equal(first.headers.get('x-reader-renderer'), null);
  assert.equal(first.headers.get('x-edge-cache'), null, 'Outer cache must be bypassed');
  assert.equal(first.headers.get('x-nextjs-cache'), 'MISS');
  await new Promise((done) => setTimeout(done, 2_000));
  await runtime.dispose();
  runtime = await createReaderRuntime(WEB_ROOT, storage);
  const second = await readProfile();
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-reader-renderer'), null);
  assert.equal(second.headers.get('x-edge-cache'), null);
  assert.equal(
    second.headers.get('x-opennext-cache'),
    'HIT',
    'Fresh instance must reuse persisted ISR'
  );
  assert.equal(second.headers.get('x-nextjs-cache'), null, 'Cached read must avoid Next rendering');
  assert.equal(second.body, first.body, 'Restart must preserve the completed profile');
  console.log('Company-profile persisted ISR survives a cold Worker restart.');
} finally {
  await runtime?.dispose();
}
