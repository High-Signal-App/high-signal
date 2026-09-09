#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  archiveIsLatest,
  publicationPrefix,
  redactionPrefix,
  validateArchivePointer,
} from './reddit-archive-publication.mjs';
import {
  COMMENT_FIELDS,
  POST_FIELDS,
  collectComments,
  collectListing,
  filterRelevantComments,
  flattenCommentThings,
  postRow,
} from './reddit-archive-lib.mjs';
import { eventRow, resolveWindow, runArchive } from './reddit-daily-archive.mjs';
import { redactArchive, verifyArchive } from './reddit-archive-maintenance.mjs';

test('post rows follow the versioned compact schema', () => {
  const row = postRow(
    {
      id: 'abc',
      subreddit: 'technology',
      title: 'Useful title',
      selftext: 'Body',
      created_utc: 1_786_291_200,
      score: 7,
      num_comments: 2,
    },
    'fallback'
  );
  assert.equal(row.length, POST_FIELDS.length);
  assert.equal(row[POST_FIELDS.indexOf('id')], 'abc');
  assert.equal(row[POST_FIELDS.indexOf('subreddit')], 'technology');
  assert.equal(row[POST_FIELDS.indexOf('body')], 'Body');
});

test('nested comments and morechildren IDs are flattened without losing relationships', () => {
  const flattened = flattenCommentThings(
    [
      {
        kind: 't1',
        data: {
          id: 'c1',
          parent_id: 't3_post',
          body: 'first',
          replies: {
            data: {
              children: [{ kind: 't1', data: { id: 'c2', parent_id: 't1_c1', body: 'reply' } }],
            },
          },
        },
      },
      { kind: 'more', data: { children: ['c3', 'c4'] } },
    ],
    'technology',
    'post'
  );
  assert.deepEqual(
    flattened.comments.map((row) => row[0]),
    ['c1', 'c2']
  );
  assert.equal(flattened.comments[0].length, COMMENT_FIELDS.length);
  assert.deepEqual(flattened.moreIds, ['c3', 'c4']);
});

test('comment relevance keeps strong replies and their low-score ancestors', () => {
  const flattened = flattenCommentThings(
    [
      {
        kind: 't1',
        data: {
          id: 'parent',
          parent_id: 't3_post',
          body: 'context',
          score: 0,
          replies: {
            data: {
              children: [
                {
                  kind: 't1',
                  data: { id: 'strong', parent_id: 't1_parent', body: 'useful', score: 8 },
                },
              ],
            },
          },
        },
      },
      { kind: 't1', data: { id: 'noise', parent_id: 't3_post', body: 'noise', score: 0 } },
    ],
    'technology',
    'post'
  );
  assert.deepEqual(
    filterRelevantComments(flattened.comments).map((row) => row[0]),
    ['parent', 'strong']
  );
});

test('derived event rows preserve attention metadata without becoming evidence', () => {
  const row = eventRow(
    {
      id: 'abc',
      permalink: '/r/technology/comments/abc/example/',
      title: 'Material discussion',
      created_utc: 1_786_291_200,
      score: 42,
      num_comments: 18,
    },
    'technology',
    '2026-08-28',
    '2026-08-28T00:18:00.000Z'
  );
  assert.equal(row.source, 'reddit:technology');
  assert.equal(row.sourceClass, 'attention_aggregator');
  assert.equal(row.confidenceContribution, 'none');
  assert.equal(row.attention.score, 42);
  assert.match(row.archive.postObject, /^reddit\/v2\/date=2026-08-28\//);
});

test('listing pagination stops once the exact 24-hour cutoff is crossed', async () => {
  const end = new Date('2026-08-28T00:17:00.000Z');
  const start = new Date(end.getTime() - 86_400_000);
  const calls = [];
  const client = {
    async getJson(_path, params) {
      calls.push(params.after || null);
      if (!params.after) {
        return {
          data: {
            after: 'page-2',
            children: [
              { data: { id: 'new', created_utc: end.getTime() / 1000 - 60 } },
              { data: { id: 'middle', created_utc: end.getTime() / 1000 - 3600 } },
            ],
          },
        };
      }
      return {
        data: {
          after: null,
          children: [{ data: { id: 'old', created_utc: start.getTime() / 1000 - 1 } }],
        },
      };
    },
  };
  const ids = [];
  const result = await collectListing({
    client,
    subreddit: 'technology',
    windowStart: start,
    windowEnd: end,
    onPost: async (post) => ids.push(post.id),
  });
  assert.deepEqual(calls, [null, 'page-2']);
  assert.deepEqual(ids, ['new', 'middle']);
  assert.equal(result.cutoffReached, true);
  assert.equal(result.listingCapped, false);
});

test('an old sticky does not stop listing pagination or duplicate a boundary post', async () => {
  const end = new Date('2026-08-28T00:17:00.000Z');
  const start = new Date(end.getTime() - 86_400_000);
  let page = 0;
  const client = {
    async getJson() {
      page += 1;
      if (page === 1) {
        return {
          data: {
            after: 'next',
            children: [
              { data: { id: 'sticky', created_utc: start.getTime() / 1000 - 100 } },
              { data: { id: 'shared', created_utc: end.getTime() / 1000 - 100 } },
            ],
          },
        };
      }
      return {
        data: {
          after: null,
          children: [
            { data: { id: 'shared', created_utc: end.getTime() / 1000 - 100 } },
            { data: { id: 'old', created_utc: start.getTime() / 1000 - 1 } },
          ],
        },
      };
    },
  };
  const ids = [];
  await collectListing({
    client,
    subreddit: 'technology',
    windowStart: start,
    windowEnd: end,
    onPost: async (post) => ids.push(post.id),
  });
  assert.equal(page, 2);
  assert.deepEqual(ids, ['shared']);
});

test('comment collection resolves morechildren and deduplicates returned comments', async () => {
  const client = {
    async getJson() {
      return [
        { data: { children: [] } },
        {
          data: {
            children: [
              { kind: 't1', data: { id: 'c1', body: 'one', score: 2 } },
              { kind: 'more', data: { children: ['c2'] } },
            ],
          },
        },
      ];
    },
    async postForm() {
      return {
        json: {
          data: {
            things: [
              { kind: 't1', data: { id: 'c1', body: 'duplicate' } },
              { kind: 't1', data: { id: 'c2', body: 'two', score: 3 } },
            ],
          },
        },
      };
    },
  };
  const rows = [];
  const result = await collectComments({
    client,
    postId: 'post',
    subreddit: 'technology',
    onComment: async (row) => rows.push(row),
  });
  assert.deepEqual(
    rows.map((row) => row[0]),
    ['c1', 'c2']
  );
  assert.deepEqual(result, { seen: 2, emitted: 2, filtered: 0, unresolvedMore: 0 });
});

test('scheduled windows use the stable 00:17 UTC boundary', () => {
  const result = resolveWindow({ scheduled: true }, new Date('2026-08-28T02:00:00.000Z'));
  assert.equal(result.windowEnd.toISOString(), '2026-08-28T00:17:00.000Z');
  assert.equal(result.windowStart.toISOString(), '2026-08-27T00:17:00.000Z');
});

test('a partial archive resumes only unfinished communities on the same persisted watermark', async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), 'high-signal-reddit-resume-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const windowEnd = new Date('2026-08-28T00:17:00.000Z');
  const windowStart = new Date(windowEnd.getTime() - 86_400_000);
  const firstCalls = [];
  const firstClient = {
    metrics: { requests: 3, retries: 0, waitedMs: 0, remaining: 99 },
    async getJson(path) {
      firstCalls.push(path);
      if (path.includes('/r/two/')) throw new Error('temporary_failure');
      const subreddit = path.includes('/r/three/') ? 'three' : 'one';
      return {
        data: {
          after: null,
          children: [
            {
              data: {
                id: `post-${subreddit}`,
                subreddit,
                title: subreddit,
                permalink: `/r/${subreddit}/comments/post-${subreddit}/example/`,
                created_utc: windowEnd.getTime() / 1000 - 60,
                score: 20,
                num_comments: 0,
              },
            },
          ],
        },
      };
    },
  };
  const partial = await runArchive({
    communities: ['one', 'two', 'three'],
    outputDir,
    windowStart,
    windowEnd,
    client: firstClient,
  });
  assert.equal(partial.manifest.status, 'partial');

  const resumedCalls = [];
  const resumedClient = {
    metrics: { requests: 1, retries: 0, waitedMs: 0, remaining: 98 },
    async getJson(path) {
      resumedCalls.push(path);
      return {
        data: {
          after: null,
          children: [
            {
              data: {
                id: 'post-two',
                subreddit: 'two',
                title: 'Two',
                permalink: '/r/two/comments/post-two/two/',
                created_utc: windowEnd.getTime() / 1000 - 120,
                score: 20,
                num_comments: 0,
              },
            },
          ],
        },
      };
    },
  };
  const complete = await runArchive({
    communities: ['one', 'two', 'three'],
    outputDir,
    windowStart,
    windowEnd,
    client: resumedClient,
    resume: true,
    objectPrefix: 'reddit/v2/run=100/attempt=1/date=2026-08-28',
  });
  assert.equal(complete.manifest.status, 'complete');
  assert.deepEqual(resumedCalls, ['/r/two/new']);
  assert.equal(complete.manifest.postCount, 3);
  const emitted = (await readFile(join(outputDir, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const newEvent = emitted.find((event) => JSON.stringify(event).includes('post-two'));
  assert.ok(newEvent);
  assert.match(
    JSON.stringify(newEvent),
    /reddit\/v2\/run=100\/attempt=1\/date=2026-08-28\/posts.jsonl.zst/
  );
  const resumedPointer = JSON.parse(await readFile(join(outputDir, 'latest.json'), 'utf8'));
  assert.equal(resumedPointer.objects.manifest, `${complete.manifest.objectPrefix}/manifest.json`);

  assert.equal(complete.manifest.resume.attempt, 2);
  assert.equal(complete.manifest.resume.reusedCommunities, 2);
  assert.equal(complete.manifest.requestMetrics.requests, 4);
  assert.equal(complete.manifest.codec.frameIndex.object, 'subreddits.index.json');
  assert.match(complete.manifest.codec.frameIndex.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await verifyArchive(outputDir)).status, 'healthy');

  const redacted = await redactArchive(outputDir, {
    postIds: new Set(['post-two']),
    commentIds: new Set(),
    reasonCode: 'reddit_user_deletion',
  });
  assert.equal(redacted.redactedPosts, 1);
  assert.equal(redacted.removedEvents, 1);
  const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.eventCount, 2);
  assert.equal(manifest.redactions.at(-1).postIdHashes.length, 1);
  manifest.objectPrefix = 'reddit/v2/run=100/attempt=1/date=2026-08-28';
  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest));
  const unrelatedLatest = JSON.parse(await readFile(join(outputDir, 'latest.json'), 'utf8'));
  unrelatedLatest.objects.manifest = 'reddit/v2/run=101/attempt=1/date=2026-08-28/manifest.json';
  const priorPointer = JSON.stringify(unrelatedLatest);
  await writeFile(join(outputDir, 'latest.json'), priorPointer);
  const oldRunRedaction = await redactArchive(outputDir, {
    postIds: new Set(['post-one']),
    commentIds: new Set(),
    reasonCode: 'reddit_user_deletion',
  });
  assert.equal(oldRunRedaction.updatesLatest, false);
  assert.equal(await readFile(join(outputDir, 'latest.json'), 'utf8'), priorPointer);
  assert.equal((await verifyArchive(outputDir, { verifyLatest: false })).status, 'healthy');
});

test('workflow exposes canonical dispatch and supports the side-machine runner', async () => {
  const workflow = await readFile('.github/workflows/cron-reddit-archive.yml', 'utf8');
  const scheduler = await readFile('workers/api/src/lib/workflow-scheduler.ts', 'utf8');
  const wrangler = await readFile('workers/api/wrangler.toml', 'utf8');
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(scheduler, /cron-reddit-archive\.yml/);
  assert.match(scheduler, /window_end/);
  assert.match(wrangler, /17 0 \* \* \*/);
  assert.match(workflow, /inputs\.cohort/);
  assert.match(workflow, /self-hosted/);
  assert.match(workflow, /ARM64/);
  assert.match(workflow, /high-signal/);
  assert.match(workflow, /REDDIT_CLIENT_ID/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /reddit-daily-archive\.mjs/);
  assert.match(workflow, /r2 object put/);
  assert.match(workflow, /reddit\/v2\/latest\.json/);
  assert.match(workflow, /events\.jsonl\.zst/);
  assert.match(workflow, /resume_run_id/);
  assert.match(workflow, /reddit-archive-verify\.mjs/);
  assert.match(workflow, /reddit-archive-publication\.mjs prepare/);

  const redactionWorkflow = await readFile('.github/workflows/reddit-archive-redact.yml', 'utf8');
  assert.match(redactionWorkflow, /confirmation/);
  assert.match(redactionWorkflow, /REDDIT_REDACT_POST_IDS/);
  assert.match(redactionWorkflow, /reddit-archive-redact\.mjs/);

  const ingestWorkflow = await readFile('.github/workflows/cron-ingest.yml', 'utf8');
  assert.match(ingestWorkflow, /Fetch canonical Reddit event export/);
  assert.match(ingestWorkflow, /REDDIT_ARCHIVE_EVENTS_PATH/);
  assert.match(ingestWorkflow, /reddit\/v2\/latest\.json/);
});

test('consumer accepts fresh legacy/per-run pointers and rejects invalid, future or stale dates', () => {
  const now = Date.parse('2026-09-09T10:00:00Z');
  for (const windowEnd of [
    undefined,
    null,
    '',
    'nonsense',
    123,
    {},
    '2026-09-09T10:00:01Z',
    '2026-09-09T01:59:59Z',
  ]) {
    assert.throws(() => validateArchivePointer({ status: 'complete', windowEnd }, now));
  }
  for (const prefix of [
    'reddit/v2/date=2026-09-09',
    'reddit/v2/run=123/attempt=1/date=2026-09-09',
  ]) {
    validateArchivePointer(
      {
        status: 'complete',
        windowEnd: '2026-09-09T02:00:00Z',
        objects: { manifest: `${prefix}/manifest.json` },
      },
      now
    );
  }
  assert.throws(() =>
    validateArchivePointer({ status: 'partial', windowEnd: '2026-09-09T10:00:00Z' }, now)
  );
});

test('redaction matches exact archive identity rather than the same date', () => {
  const date = '2026-09-09';
  const manifest = { windowEnd: `${date}T02:00:00Z`, requestedCommunities: 99 };
  const a = publicationPrefix(manifest, '123', '1', 99);
  const b = publicationPrefix(manifest, '124', '1', 99);
  const retry = publicationPrefix(manifest, '123', '2', 99);
  assert.notEqual(a, b);
  assert.notEqual(a, retry);
  const latest = { archiveDate: date, objects: { manifest: `${b}/manifest.json` } };
  assert.equal(archiveIsLatest({ ...manifest, objectPrefix: a }, latest), false);
  assert.equal(archiveIsLatest({ ...manifest, objectPrefix: b }, latest), true);
  assert.equal(archiveIsLatest(manifest, latest), false);
  assert.equal(
    archiveIsLatest(manifest, { objects: { manifest: `reddit/v2/date=${date}/manifest.json` } }),
    true
  );
  assert.throws(() => publicationPrefix(manifest, '../bad', '1', 99));
});

test('actual upload shell preserves complete payload/pointer through same-day partial and failed attempts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'reddit-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflow = await readFile('.github/workflows/cron-reddit-archive.yml', 'utf8');
  const shell = (name, source = workflow) => {
    const step = source.split(`      - name: ${name}\n`)[1].split('\n      - name:')[0];
    return step
      .split('        run: |\n')[1]
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n');
  };
  const output = join(root, 'artifacts/reddit-archive');
  const bin = join(root, 'bin');
  const storage = join(root, 'r2');
  await mkdir(output, { recursive: true });
  await mkdir(bin);
  await mkdir(join(root, 'scripts'));
  await writeFile(
    join(root, 'scripts/reddit-archive-publication.mjs'),
    await readFile('scripts/reddit-archive-publication.mjs')
  );
  const roster = join(root, 'python/ingest/src/high_signal_ingest/seed');
  await mkdir(roster, { recursive: true });
  await writeFile(join(roster, 'reddit_communities.json'), JSON.stringify({ communityCount: 99 }));
  await writeFile(
    join(bin, 'npx'),
    `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const a=process.argv.slice(2),i=a.indexOf('object'),op=a[i+1],key=a[i+2];
if(!['put','get'].includes(op))process.exit(2);
if(process.env.FAIL_OBJECT && key.endsWith(process.env.FAIL_OBJECT))process.exit(1);
const remote=path.join(process.env.MOCK_R2,key),local=a[a.indexOf('--file')+1];
const from=op==='put'?local:remote,to=op==='put'?remote:local;
fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
`,
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_R2: storage,
    RUNNER_TEMP: root,
    GITHUB_RUN_ID: '100',
    GITHUB_RUN_ATTEMPT: '1',
  };
  const run = (name, extra = {}) =>
    execFileSync('bash', ['-eu', '-o', 'pipefail', '-c', shell(name)], {
      cwd: root,
      env: { ...env, ...extra },
      stdio: 'pipe',
    });
  const fixture = async (status, content, count = 99) => {
    const manifest = { status, windowEnd: '2026-09-09T09:00:00Z', requestedCommunities: count };
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(
      join(output, 'latest.json'),
      JSON.stringify({ ...manifest, objects: {}, eventsSha256: content })
    );
    for (const name of [
      'posts.jsonl.zst',
      'comments.jsonl.zst',
      'events.jsonl.zst',
      'subreddits.index.json',
    ])
      await writeFile(join(output, name), content);
  };
  const upload = 'Upload archive and manifest to R2';
  const publish = 'Publish and verify latest complete consumer pointer';
  await fixture('complete', 'original');
  run(upload);
  run(publish);
  const pointerPath = join(storage, 'high-signal-reddit-archive/reddit/v2/latest.json');
  const original = await readFile(pointerPath, 'utf8');
  const pointer = JSON.parse(original);
  const payloadPath = join(storage, 'high-signal-reddit-archive', pointer.objects.events);
  const backup = join(root, 'first-complete');
  await cp(output, backup, { recursive: true });
  await fixture('partial', 'partial');
  run(upload, { GITHUB_RUN_ID: '101' });
  run(publish, { GITHUB_RUN_ID: '101' });
  assert.equal(await readFile(pointerPath, 'utf8'), original);
  assert.equal(await readFile(payloadPath, 'utf8'), 'original');
  await fixture('complete', 'failed');
  assert.throws(() => run(upload, { GITHUB_RUN_ID: '102', FAIL_OBJECT: 'events.jsonl.zst' }));
  assert.equal(await readFile(pointerPath, 'utf8'), original);
  assert.equal(await readFile(payloadPath, 'utf8'), 'original');
  assert.match(workflow.split(`      - name: ${publish}`)[1], /^\n {8}if: success\(\)/);
  await fixture('complete', 'canary', 10);
  run(upload, { GITHUB_RUN_ID: '103' });
  run(publish, { GITHUB_RUN_ID: '103' });
  assert.equal(await readFile(pointerPath, 'utf8'), original);
  await fixture('complete', 'replacement');
  run(upload, { GITHUB_RUN_ID: '104' });
  run(publish, { GITHUB_RUN_ID: '104' });
  assert.notEqual(await readFile(pointerPath, 'utf8'), original);
  assert.equal(await readFile(payloadPath, 'utf8'), 'original');
  assert.doesNotMatch(workflow, /r2 bucket create/);
  const redactionWorkflow = await readFile('.github/workflows/reddit-archive-redact.yml', 'utf8');
  assert.match(redactionWorkflow, /group: cron-reddit-archive\n/);
  assert.match(workflow, /group: cron-reddit-archive\n/);
  const redactionDir = join(root, 'artifacts/reddit-archive-redaction');
  await cp(backup, redactionDir, { recursive: true });
  const currentPointer = await readFile(pointerPath, 'utf8');
  await writeFile(join(redactionDir, 'latest.json'), currentPointer);
  await writeFile(join(redactionDir, 'events.jsonl.zst'), 'authorized old-run redaction');
  execFileSync(
    'bash',
    [
      '-eu',
      '-o',
      'pipefail',
      '-c',
      shell('Publish rewritten partition and verify receipt', redactionWorkflow),
    ],
    {
      cwd: root,
      env: {
        ...env,
        ARCHIVE_DATE: '2026-09-09',
        ARCHIVE_PREFIX: pointer.objects.manifest.replace('/manifest.json', ''),
      },
      stdio: 'pipe',
    }
  );
  assert.equal(await readFile(pointerPath, 'utf8'), currentPointer);
  assert.equal(await readFile(payloadPath, 'utf8'), 'authorized old-run redaction');
  await cp(output, redactionDir, { recursive: true });
  const updated = JSON.parse(currentPointer);
  updated.eventsSha256 = 'authorized-current-redaction';
  await writeFile(join(redactionDir, 'latest.json'), JSON.stringify(updated));
  execFileSync(
    'bash',
    [
      '-eu',
      '-o',
      'pipefail',
      '-c',
      shell('Publish rewritten partition and verify receipt', redactionWorkflow),
    ],
    {
      cwd: root,
      env: {
        ...env,
        ARCHIVE_DATE: '2026-09-09',
        ARCHIVE_PREFIX: updated.objects.manifest.replace('/manifest.json', ''),
      },
      stdio: 'pipe',
    }
  );
  assert.equal(JSON.parse(await readFile(pointerPath, 'utf8')).eventsSha256, updated.eventsSha256);
});

test('redaction selects validated exact run keys and retains legacy date default', () => {
  assert.equal(redactionPrefix('2026-09-09'), 'reddit/v2/date=2026-09-09');
  const prefix = 'reddit/v2/run=123/attempt=2/date=2026-09-09';
  assert.equal(redactionPrefix('2026-09-09', prefix), prefix);
  for (const bad of [
    '../latest.json',
    `${prefix}/../latest.json`,
    prefix.replace('09-09', '09-08'),
    'other/v2/date=2026-09-09',
  ])
    assert.throws(() => redactionPrefix('2026-09-09', bad));
  assert.throws(() => redactionPrefix('2026-02-30'));
});
