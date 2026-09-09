import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requestJudge } from './auto-publish-transport';

const request = {
  method: 'POST',
  body: JSON.stringify({ response_format: { type: 'json_object' }, max_tokens: 800 }),
};
const accepted = () =>
  Response.json({
    choices: [
      {
        message: { content: JSON.stringify({ verdict: 'kill', reason: 'Insufficient evidence' }) },
      },
    ],
  });

async function checkSequence(
  responses: Array<() => Response | Promise<Response>>,
  attempts: number
) {
  let calls = 0;
  const result = await requestJudge('https://judge.invalid', request, {
    retryDelayMs: 0,
    fetch: async (_url, init) => {
      assert.equal(
        init?.body,
        request.body,
        'retry must preserve structured response requirements'
      );
      assert.ok(init?.signal, 'every request has a timeout signal');
      return responses[calls++]!();
    },
  });
  assert.equal(calls, attempts);
  assert.equal(result.attempts, attempts);
  return result;
}

function checkCli() {
  const directory = mkdtempSync(join(tmpdir(), 'high-signal-judge-test-'));
  const preload = join(directory, 'transport.mjs');
  writeFileSync(
    preload,
    `
let requests = 0;
const mode = process.env.TEST_JUDGE_MODE;
const signal = {
  id: 'fixture', slug: 'fixture', signalType: 'product', primaryEntityId: 'fixture',
  direction: 'up', confidence: 'medium', predictedWindowDays: 30,
  publishedAt: new Date().toISOString(), publishable: true, independentSourceCount: 1,
  evidenceUrls: mode === 'deterministic' ? ['https://a.example/report'] :
    ['https://a.example/report', 'https://b.example/report'],
  bodyMd: 'Evidence https://a.example/report and https://b.example/report'
};
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'judge.invalid') {
    requests++;
    if (mode === 'recover' && requests === 2) return Response.json({
      choices: [{message: {content: JSON.stringify({verdict: 'kill', reason: 'Not corroborated'})}}]
    });
    return new Response('Failed to validate JSON; PRIVATE_PROVIDER_DETAIL', {status: mode === 'auth' ? 401 : 400});
  }
  if (url.hostname !== 'fixture.invalid') throw new Error('Unexpected network destination');
  if (url.pathname === '/admin/signals-review') return Response.json({
    signals: url.searchParams.get('status') === 'draft' ? [signal] : []
  });
  if (url.pathname === '/claims/by-signal/fixture') return Response.json({claims: []});
  if (url.pathname === '/admin/signals/fixture' && init.method === 'PATCH') {
    if (JSON.parse(init.body).reviewStatus !== 'killed') throw new Error('Unexpected publish');
    console.log('fixture withheld');
    return Response.json({ok: true});
  }
  throw new Error('Unexpected request');
};
process.on('exit', () => console.log('judge requests=' + requests));
`
  );
  try {
    for (const [mode, exit, attempts] of [
      ['fail', 1, 2],
      ['recover', 0, 2],
      ['auth', 1, 1],
      ['absent', 0, 0],
      ['deterministic', 0, 0],
    ] as const) {
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', preload, 'scripts/auto-publish-drafts.ts', '--local'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            TEST_JUDGE_MODE: mode,
            API_BASE: 'https://fixture.invalid',
            AI_BASE_URL: 'https://judge.invalid',
            AI_API_KEY: mode === 'absent' ? '' : 'synthetic-judge',
            ADMIN_TOKEN: 'synthetic-admin',
          },
        }
      );
      assert.equal(child.status, exit, mode + ': ' + child.stdout + child.stderr);
      assert.ok(child.stdout.includes('fixture withheld'));
      assert.ok(child.stdout.includes('judge requests=' + attempts));
      assert.ok(child.stdout.includes(exit === 1 ? '1 errors' : '0 errors'));
      assert.ok(!child.stderr.includes('PRIVATE_PROVIDER_DETAIL'));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  checkCli();
  const recovered = await checkSequence(
    [
      () => new Response('Failed to validate JSON; private provider detail', { status: 400 }),
      accepted,
    ],
    2
  );
  assert.ok('verdict' in recovered);
  assert.equal(
    recovered.verdict.verdict,
    'kill',
    'successful retry is still an editorial rejection'
  );

  for (const status of [401, 403, 400]) {
    const result = await checkSequence([() => new Response('Invalid request', { status })], 1);
    assert.deepEqual(result, { failure: `http_${status}`, attempts: 1 });
  }
  for (const status of [429, 500, 503]) {
    const result = await checkSequence(
      [() => new Response('', { status }), () => new Response('', { status })],
      2
    );
    assert.deepEqual(result, { failure: `http_${status}`, attempts: 2 });
  }
  assert.ok('verdict' in (await checkSequence([() => new Response('{invalid'), accepted], 2)));
  assert.deepEqual(
    await checkSequence(
      [() => Response.json({ choices: [] }), () => Response.json({ choices: [] })],
      2
    ),
    { failure: 'invalid_verdict', attempts: 2 }
  );
  assert.ok(
    'verdict' in
      (await checkSequence(
        [
          () => {
            throw new Error('sensitive transport details');
          },
          accepted,
        ],
        2
      ))
  );

  let timedOutCalls = 0;
  // A keepalive makes the timeout observable even though AbortSignal timers are unref'd.
  const keepalive = setInterval(() => {}, 100);
  try {
    const timedOut = await requestJudge('https://judge.invalid', request, {
      retryDelayMs: 0,
      timeoutMs: 5,
      fetch: async (_url, init) => {
        timedOutCalls++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    });
    assert.deepEqual(timedOut, { failure: 'network', attempts: 2 });
    assert.equal(timedOutCalls, 2);
  } finally {
    clearInterval(keepalive);
  }
  console.log(
    'Publisher transport: bounded retry, unchanged verdict contract, rejection and timeout checks passed.'
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
