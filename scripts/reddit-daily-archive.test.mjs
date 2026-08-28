#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  COMMENT_FIELDS,
  POST_FIELDS,
  collectComments,
  collectListing,
  flattenCommentThings,
  postRow,
} from './reddit-archive-lib.mjs';
import { resolveWindow } from './reddit-daily-archive.mjs';

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
              { kind: 't1', data: { id: 'c1', body: 'one' } },
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
              { kind: 't1', data: { id: 'c2', body: 'two' } },
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
  assert.deepEqual(result, { emitted: 2, unresolvedMore: 0 });
});

test('scheduled windows use the stable 00:17 UTC boundary', () => {
  const result = resolveWindow({ scheduled: true }, new Date('2026-08-28T02:00:00.000Z'));
  assert.equal(result.windowEnd.toISOString(), '2026-08-28T00:17:00.000Z');
  assert.equal(result.windowStart.toISOString(), '2026-08-27T00:17:00.000Z');
});

test('workflow schedules all 200 and supports the side-machine runner', async () => {
  const workflow = await readFile('.github/workflows/cron-reddit-archive.yml', 'utf8');
  assert.match(workflow, /cron: ['"]17 0 \* \* \*['"]/);
  assert.match(workflow, /inputs\.cohort/);
  assert.match(workflow, /self-hosted/);
  assert.match(workflow, /ARM64/);
  assert.match(workflow, /high-signal/);
  assert.match(workflow, /REDDIT_CLIENT_ID/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /reddit-daily-archive\.mjs/);
  assert.match(workflow, /r2 object put/);
});
