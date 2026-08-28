#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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

test('a partial archive resumes only unfinished communities on the same persisted watermark', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'high-signal-reddit-resume-'));
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
  });
  assert.equal(complete.manifest.status, 'complete');
  assert.deepEqual(resumedCalls, ['/r/two/new']);
  assert.equal(complete.manifest.postCount, 3);
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
  assert.equal((await verifyArchive(outputDir)).status, 'healthy');
});

test('workflow schedules the complete curated roster and supports the side-machine runner', async () => {
  const workflow = await readFile('.github/workflows/cron-reddit-archive.yml', 'utf8');
  assert.match(workflow, /cron: ['"]17 0 \* \* \*['"]/);
  assert.match(workflow, /inputs\.cohort/);
  assert.match(workflow, /cohort="all"/);
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

  const redactionWorkflow = await readFile('.github/workflows/reddit-archive-redact.yml', 'utf8');
  assert.match(redactionWorkflow, /confirmation/);
  assert.match(redactionWorkflow, /REDDIT_REDACT_POST_IDS/);
  assert.match(redactionWorkflow, /reddit-archive-redact\.mjs/);

  const ingestWorkflow = await readFile('.github/workflows/cron-ingest.yml', 'utf8');
  assert.match(ingestWorkflow, /Fetch canonical Reddit event export/);
  assert.match(ingestWorkflow, /REDDIT_ARCHIVE_EVENTS_PATH/);
  assert.match(ingestWorkflow, /reddit\/v2\/latest\.json/);
});
