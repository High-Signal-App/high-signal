import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requestJudge } from './auto-publish-transport';
import {
  groundJudgeVerdict,
  judgeEvidenceRejection,
  retainedJudgeEvidence,
  retainedSourceClasses,
} from './auto-publish-evidence';

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

function checkPublishWorkflowDispatch() {
  const workflow = readFileSync('.github/workflows/cron-publish.yml', 'utf8');
  const start = workflow.indexOf('      - name: Validate publisher mode inputs\n');
  assert.notEqual(start, -1, 'publisher input validation step is present');
  const end = workflow.indexOf('\n      - uses:', start);
  assert.notEqual(end, -1, 'publisher input validation step is bounded');
  const block = workflow.slice(start, end);
  const runMarker = '        run: |\n';
  const runStart = block.indexOf(runMarker);
  assert.notEqual(runStart, -1, 'publisher input validation has an executable shell block');
  const validationScript = block
    .slice(runStart + runMarker.length)
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n')
    .trim();
  const invoke = (inputs: Record<string, string>) =>
    spawnSync('bash', ['-c', validationScript], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PUBLISH_SLUG: '',
        RETRY_SLUG: '',
        INSPECT_SLUG: '',
        DRY: 'false',
        REAPPLY: 'false',
        RETRY_KILLED_TODAY: 'false',
        ...inputs,
      },
    });
  assert.equal(invoke({}).status, 0, 'empty optional input preserves the scheduled default');
  assert.equal(
    invoke({ PUBLISH_SLUG: 'nvda-approved-draft' }).status,
    0,
    'a valid target slug is accepted'
  );
  assert.notEqual(invoke({ PUBLISH_SLUG: '../other' }).status, 0, 'invalid slugs fail closed');
  for (const conflicting of [
    { RETRY_SLUG: 'other' },
    { INSPECT_SLUG: 'other' },
    { DRY: 'true' },
    { REAPPLY: 'true' },
    { RETRY_KILLED_TODAY: 'true' },
  ]) {
    assert.notEqual(
      invoke({ PUBLISH_SLUG: 'nvda-approved-draft', ...conflicting }).status,
      0,
      'targeted publishing rejects conflicting workflow inputs'
    );
  }
  assert.match(workflow, /--target-draft "--slug=\$PUBLISH_SLUG"/);
  assert.equal(
    workflow.match(
      /if: \$\{\{ inputs\.dry != true && !inputs\.inspect_slug && !inputs\.publish_slug \}\}/gu
    )?.length,
    2,
    'targeted publication skips the full brief rebuild and reader verification batch'
  );
}

function checkCli() {
  const directory = mkdtempSync(join(tmpdir(), 'high-signal-judge-test-'));
  const preload = join(directory, 'transport.mjs');
  writeFileSync(
    preload,
    `
let requests = 0;
let fetchCalls = 0;
let reviewReads = 0;
const mutations = [];
const mode = process.env.TEST_JUDGE_MODE;
const signal = {
  id: 'fixture', slug: 'fixture', signalType: 'product', primaryEntityId: 'fixture',
  direction: 'up', confidence: 'medium', predictedWindowDays: 30,
  publishedAt: mode.startsWith('retry') ? '2020-01-01T00:00:00Z' : new Date().toISOString(), publishable: true, independentSourceCount: 1,
  reviewStatus: mode === 'target-not-draft' ? 'killed' : 'draft',
  evidenceUrls: mode === 'deterministic' ? ['https://a.example/report'] :
    mode === 'same-class' ? ['https://www.thehindu.com/report', 'https://analyticsindiamag.com/report'] :
    ['https://a.example/report', 'https://b.example/report'],
  bodyMd: 'Evidence https://a.example/report and https://b.example/report'
};
if (mode.startsWith('target') && mode !== 'target-not-draft') {
  signal.independentSourceCount = 2;
  signal.bodyMd = '## What changed\\nThe company announced a manufacturing milestone and said its new production line is ready for broader commercial use.\\n' +
    '## Why it matters\\nThis milestone signals progress toward commercial adoption, although it does not establish customer orders or revenue.\\n' +
    '## Uncertainty\\nThe company did not disclose production volume, customer start dates or further commitments, so the financial impact remains uncertain.\\n' +
    'Sources: https://a.example/report and https://b.example/report';
}
if (mode === 'prose' || mode === 'oversized') {
  signal.independentSourceCount = 2;
  signal.bodyMd = '## What changed\\nThe company announced a manufacturing milestone covering research, certification and selected production layers.\\n## Why it matters\\nThe announcement provides evidence of manufacturing progress, while the business implications depend on customer adoption.\\n## Uncertainty\\nFuture customer commitments, manufacturing costs and the timing of further deployments remain unverified.\\nSources: https://a.example/report and https://b.example/report\\n' +
    'Background context. '.repeat(mode === 'oversized' ? 1000 : 150) +
    'Unsupported company roles at the end of the draft.';
}
globalThis.fetch = async (input, init) => {
  fetchCalls++;
  const url = new URL(String(input));
  if (url.hostname === 'judge.invalid') {
    if (init.headers.Authorization !== 'Bearer synthetic-judge') throw new Error('Judge credential whitespace not normalized');
    const system = JSON.parse(init.body).messages[0].content;
    if (!system.includes('required fields for EVERY decision') || !system.includes('reason: a nonempty string')) throw new Error('Judge response contract missing');
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    if (JSON.stringify(payload.sourceClasses) !== JSON.stringify(['official', 'news'])) throw new Error('Retained source classes lost');
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
    if (mode.startsWith('target')) {
      return Response.json({choices: [{message: {content: JSON.stringify({
        verdict: 'publish', reason: 'Issuer and independent retained evidence support the claim',
        claimTuple: {entity: 'fixture', event: 'reinstatement', amount: null, date: '2026-11-23', direction: 'up'},
        evidenceAssessments: signal.evidenceUrls.map((url, index) => ({
          url, aligned: true, originatingEvidenceId: 'origin-' + index
        }))
      })}}]});
    }
    if (mode === 'recover' && requests === 2) return Response.json({
      choices: [{message: {content: JSON.stringify({verdict: 'kill', reason: 'Not corroborated'})}}]
    });
    return new Response('Failed to validate JSON; PRIVATE_PROVIDER_DETAIL', {status: mode === 'auth' ? 401 : 400});
  }
  if (url.hostname !== 'fixture.invalid') throw new Error('Unexpected network destination');
  if (url.pathname === '/signals') {
    return Response.json({signals: url.searchParams.get('status') === 'draft' ? [signal] : []});
  }
  if (url.pathname === '/admin/signals-review') {
    if (mode.startsWith('retry') && url.searchParams.get('status') === 'killed') throw new Error('Historical retry used capped list');
    if (init.headers.Authorization !== 'Bearer synthetic-admin') throw new Error('Admin credential whitespace not normalized');
    const status = url.searchParams.get('status');
    return Response.json({
      signals: status === (mode.startsWith('retry') ? 'killed' : 'draft') && mode !== 'target-capped-list'
        ? [signal, {...signal, id:'other', slug:'other', reviewStatus:'draft'}]
        : []
    });
  }
  if (url.pathname === '/claims/by-signal/fixture' || url.pathname === '/signals/fixture') {
    return Response.json({error:'history_verification_required'}, {status:403});
  }
  if (url.pathname === '/admin/signals-review/fixture') {
    if (init.headers?.Authorization !== 'Bearer synthetic-admin') throw new Error('Protected review credential missing');
    if (mode === 'lookup-failed') return new Response('', {status:503});
    if (mode === 'retry-missing') return new Response('', {status:404});
    reviewReads++;
    const staleTarget = mode.startsWith('target-stale') && reviewReads >= 3;
    const changedTargetId = mode === 'target-stale-identity' && reviewReads >= 3;
    const hasTargetClaim = ['targeted-publish', 'target-capped-list', 'target-stale-identity', 'target-stale-before-claim-publish', 'target-stale-before-signal-patch'].includes(mode);
    return Response.json({
      signal: {...signal, id: changedTargetId ? 'replacement' : signal.id, reviewStatus: staleTarget ? 'killed' : mode === 'retry-published' ? 'published' : mode.startsWith('retry') ? 'killed' : signal.reviewStatus},
      claims: mode === 'prose' || mode === 'oversized' || hasTargetClaim ? [{
        id: hasTargetClaim ? 'claim-fixture' : 'claim',
        signalId: 'fixture', surface: 'signal', assertion: 'fixture claim', confidenceBand: 'medium',
        reviewStatus: mode === 'target-stale-before-signal-patch' ? 'published' : 'draft', evidence: signal.evidenceUrls.map((evidenceUrl, index) => ({
          id: 'link-' + index, claimId: hasTargetClaim ? 'claim-fixture' : 'claim', evidenceUrl,
          sourceDocumentId: 'source-doc-' + index,
          originatingEvidenceId: 'origin-' + index,
          semanticAlignment: 'verified', role: index === 0 ? 'primary' : 'corroboration', weight: 1,
          notes: 'receipt:verified alignment:verified verifier:auto-publish-semantic-judge'
        }))
      }] : [],
      evidence: mode === 'no-text' || mode.startsWith('retry') ? [] : signal.evidenceUrls.map((url, index) => ({
        url, excerpt: 'Retained public source excerpt for ' + url, sourceType: index === 0 && mode !== 'same-class' ? 'ir' : 'news'
      }))});
  }
  if (url.pathname === '/admin/claims' && init.method === 'POST') {
    mutations.push('claim:create');
    return Response.json({id: 'new-claim'});
  }
  if (url.pathname === '/admin/claims/claim-fixture/status' && init.method === 'POST') {
    mutations.push('claim:fixture:' + JSON.parse(init.body).status);
    return Response.json({ok: true});
  }
  if (url.pathname === '/admin/signals/fixture' && init.method === 'PATCH') {
    const status = JSON.parse(init.body).reviewStatus;
    mutations.push('signal:fixture:' + status);
    if (status === 'killed') console.log('fixture withheld');
    else if (status === 'published') console.log('fixture published');
    else throw new Error('Unexpected moderation status');
    return Response.json({ok: true});
  }
  throw new Error('Unexpected request');
};
process.on('exit', () => {
  console.log('judge requests=' + requests);
  console.log('fetch calls=' + fetchCalls);
  console.log('mutations=' + JSON.stringify(mutations));
});
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
      ['same-class', 0, 0],
      ['lookup-failed', 1, 0],
      ['prose', 0, 1],
      ['oversized', 0, 0],
      ['retry', 0, 0],
      ['retry-dry', 0, 0],
    ] as const) {
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          preload,
          'scripts/auto-publish-drafts.ts',
          '--local',
          '--slug=fixture',
          ...(mode.startsWith('retry') ? ['--retry-killed'] : []),
          ...(mode === 'retry-dry' ? ['--dry'] : []),
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            TEST_JUDGE_MODE: mode,
            API_BASE: 'https://fixture.invalid',
            AI_BASE_URL: 'https://judge.invalid',
            AI_API_KEY: mode === 'absent' ? '' : ' \tsynthetic-judge\r\n',
            ADMIN_TOKEN: ' \tsynthetic-admin\r\n',
          },
        }
      );
      assert.equal(child.status, exit, mode + ': ' + child.stdout + child.stderr);
      assert.equal(
        child.stdout.includes('fixture withheld'),
        mode !== 'lookup-failed' && mode !== 'retry-dry'
      );
      assert.ok(child.stdout.includes('judge requests=' + attempts));
      assert.ok(child.stdout.includes(exit === 1 ? '1 errors' : '0 errors'));
      assert.ok(!child.stderr.includes('PRIVATE_PROVIDER_DETAIL'));
      if (mode.startsWith('retry'))
        assert.ok(child.stdout.includes('1 killed rows (bounded retry)'));
    }
    const targeted = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        preload,
        'scripts/auto-publish-drafts.ts',
        '--remote',
        '--target-draft',
        '--slug=fixture',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          TEST_JUDGE_MODE: 'target-capped-list',
          API_BASE: 'https://fixture.invalid',
          AI_BASE_URL: 'https://judge.invalid',
          AI_API_KEY: 'synthetic-judge',
          ADMIN_TOKEN: 'synthetic-admin',
        },
      }
    );
    assert.equal(targeted.status, 0, targeted.stdout + targeted.stderr);
    assert.match(targeted.stdout, /fixture published/);
    assert.match(targeted.stdout, /judge requests=1/);
    assert.match(
      targeted.stdout,
      /mutations=\["claim:fixture:published","signal:fixture:published"\]/
    );
    assert.doesNotMatch(targeted.stdout, /other/);

    const noAdminToken = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--import', preload, 'scripts/auto-publish-drafts.ts', '--local'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          TEST_JUDGE_MODE: 'no-admin-kill',
          API_BASE: 'https://fixture.invalid',
          AI_API_KEY: '',
          ADMIN_TOKEN: '',
        },
      }
    );
    assert.equal(noAdminToken.status, 1, noAdminToken.stdout + noAdminToken.stderr);
    assert.match(noAdminToken.stderr, /would PATCH fixture.*no ADMIN_TOKEN/);
    assert.doesNotMatch(noAdminToken.stderr, /ReferenceError/);
    assert.match(noAdminToken.stdout, /mutations=\[\]/);

    for (const mode of [
      'target-stale-identity',
      'target-stale-before-claim-create',
      'target-stale-before-claim-publish',
      'target-stale-before-signal-patch',
    ]) {
      const stale = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          preload,
          'scripts/auto-publish-drafts.ts',
          '--remote',
          '--target-draft',
          '--slug=fixture',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            TEST_JUDGE_MODE: mode,
            API_BASE: 'https://fixture.invalid',
            AI_BASE_URL: 'https://judge.invalid',
            AI_API_KEY: 'synthetic-judge',
            ADMIN_TOKEN: 'synthetic-admin',
          },
        }
      );
      assert.equal(stale.status, 1, mode + ': ' + stale.stdout + stale.stderr);
      assert.match(
        stale.stderr,
        /target (?:is no longer the same draft|identity changed during review)/
      );
      assert.match(stale.stdout, /mutations=\[\]/);
      assert.match(stale.stdout, /judge requests=1/);
    }

    const notDraft = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        preload,
        'scripts/auto-publish-drafts.ts',
        '--remote',
        '--target-draft',
        '--slug=fixture',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          TEST_JUDGE_MODE: 'target-not-draft',
          API_BASE: 'https://fixture.invalid',
          ADMIN_TOKEN: 'synthetic-admin',
        },
      }
    );
    assert.equal(notDraft.status, 1);
    assert.match(notDraft.stderr, /requires the selected slug to be in draft status/);
    assert.match(notDraft.stdout, /judge requests=0/);
    assert.match(notDraft.stdout, /mutations=\[\]/);

    for (const mode of ['retry-missing', 'retry-published']) {
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          preload,
          'scripts/auto-publish-drafts.ts',
          '--retry-killed',
          '--slug=fixture',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            TEST_JUDGE_MODE: mode,
            API_BASE: 'https://fixture.invalid',
            ADMIN_TOKEN: 'synthetic-admin',
          },
        }
      );
      assert.equal(child.status, 1);
      assert.match(
        child.stderr,
        /Retry target lookup failed \(HTTP 404\)|Retry target is not a rejected signal/
      );
      assert.doesNotMatch(child.stdout, /fixture withheld/);
      assert.ok(child.stdout.includes('judge requests=0'));
    }
    for (const invalid of [
      ['--retry-killed'],
      ['--retry-killed', '--slug=../other'],
      ['--retry-killed', '--slug=fixture', '--reapply'],
      ['--retry-killed', '--slug=fixture', '--retry-killed-today'],
    ]) {
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', preload, 'scripts/auto-publish-drafts.ts', ...invalid],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            TEST_JUDGE_MODE: 'reject-options',
            ADMIN_TOKEN: 'synthetic-admin',
            API_BASE: 'https://fixture.invalid',
          },
        }
      );
      assert.equal(child.status, 1);
      assert.match(child.stderr, /requires one valid --slug/);
      assert.doesNotMatch(child.stdout, /fixture withheld/);
      assert.ok(child.stdout.includes('judge requests=0'));
      assert.ok(child.stdout.includes('fetch calls=0'));
    }
    for (const invalid of [
      ['--target-draft', '--remote'],
      ['--target-draft', '--remote', '--slug=../other'],
      ['--target-draft', '--remote', '--slug=fixture', '--dry'],
      ['--target-draft', '--remote', '--slug=fixture', '--retry-killed'],
      ['--target-draft', '--remote', '--slug=fixture', '--retry-killed-today'],
      ['--target-draft', '--remote', '--slug=fixture', '--reapply'],
      ['--target-draft', '--local', '--slug=fixture'],
    ]) {
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', preload, 'scripts/auto-publish-drafts.ts', ...invalid],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            TEST_JUDGE_MODE: 'reject-options',
            ADMIN_TOKEN: 'synthetic-admin',
            API_BASE: 'https://fixture.invalid',
          },
        }
      );
      assert.equal(child.status, 1);
      assert.match(child.stderr, /--target-draft requires/);
      assert.ok(child.stdout.includes('judge requests=0'));
      assert.ok(child.stdout.includes('fetch calls=0'));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  checkPublishWorkflowDispatch();
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
    retainedSourceClasses(
      retainedJudgeEvidence(urls, {
        evidence: [
          { url: urls[0], excerpt: 'Issuer measurement', sourceType: 'ir' },
          { url: urls[1], excerpt: 'Independent measurement', sourceType: 'news' },
        ],
      })
    ),
    ['official', 'news']
  );
  assert.deepEqual(
    retainedJudgeEvidence(urls, { evidence: [{ url: urls[0], excerpt: ' ' }] }),
    urls.map((url) => ({ url, excerpt: null, textCoverage: 'unavailable' }))
  );
  const publish = {
    verdict: 'publish' as const,
    source: 'ai' as const,
    reason: 'Aligned excerpts',
    claimTuple: {
      entity: 'OPENAI',
      event: 'Measured improvement',
      amount: null,
      date: '2026-09-09',
      direction: 'up' as const,
    },
    evidenceAssessments: urls.map((url, index) => ({
      url,
      aligned: true,
      originatingEvidenceId: String(index),
    })),
  };
  assert.equal(groundJudgeVerdict(publish, evidence).verdict, 'publish');
  const newsUrls = ['https://www.thehindu.com/report', 'https://analyticsindiamag.com/report'];
  const sameClassEvidence = evidence.map((item, index) => ({
    ...item,
    url: newsUrls[index],
    sourceType: 'news',
  }));
  const newsPublish = {
    ...publish,
    evidenceAssessments: publish.evidenceAssessments.map((item, index) => ({
      ...item,
      url: newsUrls[index],
    })),
  };
  assert.equal(
    groundJudgeVerdict(newsPublish, sameClassEvidence).verdict,
    'kill',
    'two news citations do not satisfy the final judge’s different-source-class rule'
  );
  const officialUrl = 'https://www.businesswire.com/release';
  const official = {
    url: officialUrl,
    excerpt: 'Retained official announcement',
    textCoverage: 'retained_excerpt' as const,
    sourceType: 'news',
  };
  assert.equal(
    groundJudgeVerdict(
      {
        ...publish,
        evidenceAssessments: [
          ...newsPublish.evidenceAssessments,
          { url: officialUrl, aligned: false, originatingEvidenceId: 'unrelated-release' },
        ],
      },
      [...sameClassEvidence, official]
    ).verdict,
    'kill',
    'an unrelated official citation does not add an aligned source class'
  );
  assert.equal(
    groundJudgeVerdict(
      {
        ...publish,
        evidenceAssessments: [
          newsPublish.evidenceAssessments[0],
          { url: officialUrl, aligned: true, originatingEvidenceId: 'official-release' },
        ],
      },
      [sameClassEvidence[0], official]
    ).verdict,
    'publish',
    'aligned independent news and official evidence still pass'
  );
  assert.deepEqual(retainedSourceClasses([sameClassEvidence[0], official]), ['news', 'official']);
  const issuerNewsroom = { ...official, url: 'https://news.microsoft.com/announcement' };
  assert.equal(judgeEvidenceRejection([sameClassEvidence[0], issuerNewsroom]), null);
  assert.deepEqual(
    retainedSourceClasses([
      sameClassEvidence[0],
      { ...official, url: 'https://www.nextgov.com/report' },
    ]),
    ['news'],
    'a gov substring cannot reclassify an editorial site as official'
  );
  const excludedDiscussion = retainedJudgeEvidence(urls, {
    evidence: [
      { url: urls[0], excerpt: 'Official announcement', sourceType: 'news' },
      {
        url: urls[1],
        excerpt: 'Firsthand discussion retained only for attention',
        sourceType: 'reddit',
        contextOnly: true,
      },
    ],
  });
  assert.equal(
    groundJudgeVerdict(publish, excludedDiscussion).verdict,
    'kill',
    'model alignment cannot override a retained no-confidence source policy'
  );
  assert.equal(groundJudgeVerdict({ ...publish, claimTuple: undefined }, evidence).verdict, 'kill');
  assert.equal(
    groundJudgeVerdict(
      {
        ...publish,
        evidenceAssessments: [
          ...publish.evidenceAssessments,
          {
            url: 'https://uncited.example/result',
            aligned: false,
            originatingEvidenceId: 'uncited',
          },
        ],
      },
      evidence
    ).verdict,
    'kill',
    'even unaligned uncited assessments are rejected'
  );
  assert.equal(
    groundJudgeVerdict(
      {
        ...publish,
        evidenceAssessments: publish.evidenceAssessments.map((item) => ({
          ...item,
          originatingEvidenceId: 'same-origin',
        })),
      },
      evidence
    ).verdict,
    'kill'
  );
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
    groundJudgeVerdict(wirePublish, wireEvidence).reason,
    'explicit wire attribution contradicts model-certified source independence'
  );
  const businessWireUrl = 'https://www.businesswire.com/report';
  assert.equal(
    groundJudgeVerdict(
      {
        ...wirePublish,
        evidenceAssessments: [
          wirePublish.evidenceAssessments[0],
          { ...wirePublish.evidenceAssessments[1], url: businessWireUrl },
        ],
      },
      [
        wireEvidence[0],
        {
          ...wireEvidence[1],
          url: businessWireUrl,
          excerpt: 'A separate primary release mentions Bloomberg in passing.',
          sourceType: 'news',
        },
      ]
    ).verdict,
    'publish',
    'an ordinary wire mention is not a syndicated reprint'
  );
  const absent = retainedJudgeEvidence(urls, null);
  assert.equal(groundJudgeVerdict(publish, absent).verdict, 'kill');
  assert.equal(
    retainedJudgeEvidence(urls, { evidence: [{ url: urls[0], excerpt: 'x'.repeat(2000) }] })[0]
      .excerpt?.length,
    1500
  );
  const metadata = evidence.map((item, index) =>
    index === 0 ? { ...item, sourceType: 'techmeme' } : item
  );
  assert.equal(
    groundJudgeVerdict(publish, metadata).verdict,
    'kill',
    'external publisher URL and model origin cannot promote Techmeme metadata'
  );
  assert.equal(retainedSourceClasses(metadata)[0], 'other');
  assert.equal(
    groundJudgeVerdict(
      publish,
      evidence.map((item) => ({
        ...item,
        sourceType: 'news:hackernews-original:publisher.example',
      }))
    ).verdict,
    'publish'
  );
  const mislabeledMetadata = evidence.map((item, index) =>
    index === 0
      ? {
          ...item,
          sourceType: 'news',
          excerpt: 'Techmeme permalink: https://www.techmeme.com/261024/p1\nRSS summary',
        }
      : item
  );
  assert.equal(groundJudgeVerdict(publish, mislabeledMetadata).verdict, 'kill');
  assert.equal(retainedSourceClasses(mislabeledMetadata)[0], 'other');
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
