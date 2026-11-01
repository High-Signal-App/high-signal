import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createReaderRuntime, WEB_ROOT } from './reader-runtime.mjs';
import { recordFixtureApi } from './public-record-fixture.mjs';

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const samples = process.argv.includes('--samples') ? Number(argument('--samples')) : 5;
const count = process.argv.includes('--records') ? Number(argument('--records')) : 16;
const expectedCalls = process.argv.includes('--expected-calls')
  ? Number(argument('--expected-calls'))
  : undefined;
assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 10);
assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 64);
const reference = process.argv.includes('--reference')
  ? JSON.parse(readFileSync(argument('--reference'), 'utf8'))
  : null;
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function profileSession(mf) {
  const inspector = await mf.getInspectorURL();
  const list = new URL('/json', inspector);
  list.protocol = 'http:';
  const targets = await (await fetch(list)).json();
  const target = targets.find((item) => /reader/.test(item.title)) ?? targets[0];
  assert.ok(target?.webSocketDebuggerUrl, 'workerd inspector must expose its Worker target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    message.error
      ? callback.reject(new Error(JSON.stringify(message.error)))
      : callback.resolve(message.result);
  });
  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 1_000 });
  await send('Profiler.start');
  return async () => {
    const { profile } = await send('Profiler.stop');
    socket.close();
    return profile;
  };
}

const results = [];
const bodies = {};
for (let sample = 0; sample < samples; sample++) {
  const calls = [];
  const mf = await createReaderRuntime(WEB_ROOT, undefined, {
    api: recordFixtureApi(calls),
    ...(process.argv.includes('--profile') ? { inspectorPort: 0 } : {}),
    ...(process.argv.includes('--reuse-bundle-manifest')
      ? { reuseBundleManifest: argument('--reuse-bundle-manifest') }
      : process.argv.includes('--bundle-manifest')
        ? sample === 0
          ? { bundleManifest: argument('--bundle-manifest') }
          : { reuseBundleManifest: argument('--bundle-manifest') }
        : {}),
  });
  const wall = [];
  const handlerWall = [];
  let stopProfile;
  try {
    await mf.ready;
    if (process.argv.includes('--profile')) stopProfile = await profileSession(mf);
    for (let index = 0; index < count; index++) {
      const id = `record-${String(index).padStart(4, '0')}`;
      const path =
        index % 3 === 0
          ? `/data/records/${id}.md`
          : index % 3 === 1
            ? `/api/md/data/records/${id}`
            : `/data/records/${id}`;
      const started = performance.now();
      const response = await mf.dispatchFetch(`https://highsignal.app${path}`, {
        headers: { Accept: 'text/markdown' },
      });
      const body = await response.text();
      wall.push(performance.now() - started);
      assert.equal(response.status, 200, `${sample}/${path}`);
      assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
      assert.ok(body.includes(`Retained evidence ${id}`));
      assert.ok(body.includes(`Canonical: https://highsignal.app/data/records/${id}`));
      assert.ok(body.includes(`Original extract for ${id}.`));
      assert.ok(body.includes(`Retained evidence for ${id}.`));
      assert.ok(body.includes('retained text (truncated)'));
      assert.doesNotMatch(body, /Temporarily unavailable|No public Markdown page/);
      const timing = response.headers.get('server-timing')?.match(/dur=([\d.]+)/);
      assert.ok(timing, 'actual deployed handler must supply timing');
      handlerWall.push(Number(timing[1]));
      const hash = sha(body);
      if (reference)
        assert.equal(hash, reference.bodies[id]?.sha256, `exact Markdown parity: ${id}`);
      if (sample === 0) bodies[id] = { sha256: hash, body };
    }
    assert.ok(
      calls.every(
        (call) =>
          call.method === 'GET' &&
          call.search === '' &&
          !call.cookie &&
          !call.authorization &&
          !call.access
      )
    );
    if (expectedCalls !== undefined)
      assert.equal(
        calls.length,
        count * expectedCalls,
        'backend calls for unique uncached records'
      );
    if (stopProfile) {
      writeFileSync(
        argument('--profile').replace(/\.cpuprofile$/, '') + `-${sample}.cpuprofile`,
        JSON.stringify(await stopProfile())
      );
      stopProfile = null;
    }
    results.push({
      sample,
      requests: count,
      backendCalls: calls.length,
      wallMs: wall,
      handlerWallMs: handlerWall,
    });
  } finally {
    if (stopProfile) await stopProfile();
    await mf.dispose();
  }
}
const report = {
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  bundle:
    process.argv.includes('--reuse-bundle-manifest') || process.argv.includes('--bundle-manifest')
      ? JSON.parse(
          readFileSync(
            argument(
              process.argv.includes('--reuse-bundle-manifest')
                ? '--reuse-bundle-manifest'
                : '--bundle-manifest'
            ),
            'utf8'
          )
        )
      : null,
  workload:
    'compiled workerd, isolated empty cache per sample, distinct public record IDs, fixed bounded API responses',
  cpuMeasured: false,
  limitations: [
    'Local workerd replay; timing is wall time, not billed CPU. Backend uses fixed local binding responses.',
  ],
  results,
  bodies,
};
if (process.argv.includes('--output'))
  writeFileSync(argument('--output'), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      ...report,
      bodies: Object.fromEntries(Object.entries(bodies).map(([id, value]) => [id, value.sha256])),
    },
    null,
    2
  )
);
