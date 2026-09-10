import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requestJudge } from './auto-publish-transport';
import { groundJudgeVerdict, retainedJudgeEvidence } from './auto-publish-evidence';

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
if (mode === 'prose' || mode === 'oversized') {
  signal.independentSourceCount = 2;
  signal.bodyMd = '## What changed\\nThe company announced a manufacturing milestone covering research, certification and selected production layers.\\n## Why it matters\\nThe announcement provides evidence of manufacturing progress, while the business implications depend on customer adoption.\\n## Uncertainty\\nFuture customer commitments, manufacturing costs and the timing of further deployments remain unverified.\\nSources: https://a.example/report and https://b.example/report\\n' +
    'Background context. '.repeat(mode === 'oversized' ? 1000 : 150) +
    'Unsupported company roles at the end of the draft.';
}
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'judge.invalid') {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    if (payload.evidence?.length !== 2 || payload.evidence.some(item =>
      item.textCoverage !== 'retained_excerpt' || !item.excerpt.startsWith('Retained public source excerpt'))) {
      throw new Error('Judge did not receive retained source excerpts');
    }
    requests++;
    if (mode === 'prose') {
      if (!payload.body.endsWith('Unsupported company roles at the end of the draft.')) {
        throw new Error('Judge did not receive the complete prose');
      }
      return Response.json({choices: [{message: {content: JSON.stringify({
        verdict: 'kill', reason: 'Unsupported supplier roles in the body'
      })}}]});
    }
    if (mode === 'recover' && requests === 2) return Response.json({
      choices: [{message: {content: JSON.stringify({verdict: 'kill', reason: 'Not corroborated'})}}]
    });
    return new Response('Failed to validate JSON; PRIVATE_PROVIDER_DETAIL', {status: mode === 'auth' ? 401 : 400});
  }
  if (url.hostname !== 'fixture.invalid') throw new Error('Unexpected network destination');
  if (url.pathname === '/admin/signals-review') return Response.json({
    signals: url.searchParams.get('status') === 'draft' ? [signal] : []
  });
  if (url.pathname === '/claims/by-signal/fixture') return Response.json({
    claims: mode === 'prose' || mode === 'oversized' ? [{
      id: 'claim', reviewStatus: 'draft', evidence: signal.evidenceUrls.map((evidenceUrl, index) => ({
        id: 'link-' + index, claimId: 'claim', evidenceUrl,
        sourceDocumentId: 'origin-' + index,
        role: index === 0 ? 'primary' : 'corroboration', weight: 1,
        notes: 'alignment:verified'
      }))
    }] : []
  });
  if (url.pathname === '/signals/fixture') {
    if (mode === 'lookup-failed') return new Response('', {status: 503});
    return Response.json({evidence: mode === 'no-text' ? [] : signal.evidenceUrls.map(url => ({
      url, excerpt: 'Retained public source excerpt for ' + url
    }))});
  }
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
      ['no-text', 0, 0],
      ['lookup-failed', 1, 0],
      ['prose', 0, 1],
      ['oversized', 0, 0],
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
      assert.equal(child.stdout.includes('fixture withheld'), mode !== 'lookup-failed');
      assert.ok(child.stdout.includes('judge requests=' + attempts));
      assert.ok(child.stdout.includes(exit === 1 ? '1 errors' : '0 errors'));
      assert.ok(!child.stderr.includes('PRIVATE_PROVIDER_DETAIL'));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const urls = ['https://a.example/report', 'https://b.example/report'];
  const evidence = retainedJudgeEvidence(urls, {
    evidence: [
      { url: urls[0], excerpt: '  Retained source A  ' },
      { url: urls[1], excerpt: 'Retained source B' },
      { url: 'https://unrelated.example', excerpt: 'Not cited' },
    ],
  });
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].excerpt, 'Retained source A');
  assert.equal(evidence[0].textCoverage, 'retained_excerpt');
  assert.deepEqual(
    retainedJudgeEvidence(urls, { evidence: [{ url: urls[0], excerpt: ' ' }] }),
    urls.map((url) => ({ url, excerpt: null, textCoverage: 'unavailable' }))
  );
  const publish = {
    verdict: 'publish' as const,
    source: 'ai' as const,
    reason: 'Aligned excerpts',
    evidenceAssessments: urls.map((url, index) => ({
      url,
      aligned: true,
      originatingEvidenceId: String(index),
    })),
  };
  assert.equal(groundJudgeVerdict(publish, evidence).verdict, 'publish');
  assert.equal(groundJudgeVerdict(publish, evidence.slice(0, 1)).verdict, 'kill');
  assert.equal(
    groundJudgeVerdict(
      {
        ...publish,
        evidenceAssessments: [publish.evidenceAssessments[0], publish.evidenceAssessments[0]],
      },
      evidence
    ).verdict,
    'kill',
    'duplicate assessments are not two sources'
  );
  const wireUrls = ['https://www.bloomberg.com/news/report', 'https://www.livemint.com/report'];
  const wirePublish = {
    ...publish,
    evidenceAssessments: wireUrls.map((url, index) => ({
      url,
      aligned: true,
      originatingEvidenceId: String(index),
    })),
  };
  const wireEvidence = retainedJudgeEvidence(wireUrls, {
    evidence: [
      { url: wireUrls[0], excerpt: 'Original reporting from the wire service.' },
      { url: wireUrls[1], excerpt: '(Bloomberg) -- The same report republished by Mint.' },
    ],
  });
  assert.equal(
    groundJudgeVerdict(wirePublish, wireEvidence).verdict,
    'kill',
    'wire reprint cannot be certified as independent'
  );
  assert.equal(
    groundJudgeVerdict(
      wirePublish,
      wireEvidence.map((item, index) =>
        index === 1
          ? { ...item, excerpt: 'Our own investigation mentions Bloomberg in passing.' }
          : item
      )
    ).verdict,
    'publish',
    'ordinary publisher mentions do not prove syndication'
  );
  const absent = retainedJudgeEvidence(urls, null);
  assert.equal(groundJudgeVerdict(publish, absent).verdict, 'kill');
  assert.equal(
    retainedJudgeEvidence(urls, { evidence: [{ url: urls[0], excerpt: 'x'.repeat(2000) }] })[0]
      .excerpt?.length,
    1500
  );
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
