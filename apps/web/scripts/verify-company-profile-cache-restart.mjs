import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { get } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after cf:build. Real workerd + local R2, with no production bindings.
// Authorization bypasses the outer document cache so this checks shared ISR.
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const storage = await mkdtemp(join(tmpdir(), 'high-signal-isr-restart-'));
const socket = createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
let worker;

async function stop() {
  if (!worker || worker.exitCode !== null) return;
  const stopped = new Promise((resolve) => worker.once('exit', resolve));
  process.kill(-worker.pid, 'SIGTERM');
  await stopped;
}

async function start() {
  worker = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--local-protocol',
      'https',
      '--persist-to',
      storage,
    ],
    { cwd: webRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local Worker startup timed out')), 30_000);
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local Worker exited during startup (${code})`));
    });
    const observe = (data) => {
      if (String(data).includes('Ready on')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    worker.stdout.on('data', observe);
    worker.stderr.on('data', observe);
  });
}

function readProfile() {
  return new Promise((resolve, reject) => {
    // TLS verification is disabled only for Wrangler's localhost test certificate.
    const request = get(
      `https://127.0.0.1:${port}/case-studies/openai`,
      { rejectUnauthorized: false, headers: { authorization: 'Bearer local-cache-test' } },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
        response.on('error', reject);
      }
    );
    request.setTimeout(20_000, () => request.destroy(new Error('Profile request timed out')));
    request.on('error', reject);
  });
}

try {
  await start();
  const first = await readProfile();
  assert.equal(first.status, 200);
  assert.match(first.body, /data-high-signal-public-cache="company-profile-v1"/);
  assert.equal(first.headers['x-edge-cache'], undefined, 'Outer cache must be bypassed');
  assert.equal(first.headers['x-nextjs-cache'], 'MISS');
  // Leave Next's one-second default behind, then clear all process-local state.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await stop();
  await start();
  const second = await readProfile();
  assert.equal(second.status, 200);
  assert.equal(second.headers['x-edge-cache'], undefined);
  assert.equal(
    second.headers['x-opennext-cache'],
    'HIT',
    'Fresh instance must reuse persisted ISR'
  );
  assert.equal(
    second.headers['x-nextjs-cache'],
    undefined,
    'Cached read must avoid Next rendering'
  );
  assert.equal(second.body, first.body, 'Restart must preserve the completed profile');
  console.log('Company-profile persisted ISR survives a cold Worker restart.');
} finally {
  await stop();
}
