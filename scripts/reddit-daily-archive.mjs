#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ARCHIVE_SCHEMA_VERSION,
  COMMENT_MIN_SCORE,
  COMMENT_FIELDS,
  EVENT_MIN_COMMENTS,
  EVENT_MIN_SCORE,
  POST_FIELDS,
  collectComments,
  collectListing,
  createRedditClient,
  postQualifiesForEvent,
  postRow,
} from './reddit-archive-lib.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER_PATH = resolve(
  ROOT,
  'python/ingest/src/high_signal_ingest/seed/reddit_communities.json'
);
const DEFAULT_OUTPUT = resolve(ROOT, 'artifacts/reddit-archive');
const USER_AGENT = 'high-signal-reddit-archive/1.0 (daily public-data archive)';

function parseArgs(argv) {
  const options = { cohort: 'all', outputDir: DEFAULT_OUTPUT, scheduled: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cohort') options.cohort = argv[++index];
    else if (argument === '--output-dir') options.outputDir = resolve(argv[++index]);
    else if (argument === '--window-end') options.windowEnd = new Date(argv[++index]);
    else if (argument === '--scheduled') options.scheduled = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

function mostRecentScheduledBoundary(now) {
  const boundary = new Date(now);
  boundary.setUTCHours(0, 17, 0, 0);
  if (boundary > now) boundary.setUTCDate(boundary.getUTCDate() - 1);
  return boundary;
}

export function resolveWindow(options, now = new Date()) {
  const windowEnd = options.windowEnd
    ? new Date(options.windowEnd)
    : options.scheduled
      ? mostRecentScheduledBoundary(now)
      : now;
  if (Number.isNaN(windowEnd.getTime())) throw new Error('invalid_window_end');
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  return { windowStart, windowEnd };
}

async function loadCommunities(cohort) {
  const roster = JSON.parse(await readFile(ROSTER_PATH, 'utf8'));
  if (cohort === 'all') return roster.communities;
  if (cohort === '10' || cohort === 'phase10') return roster.rollout.phase10;
  throw new Error(`unknown_cohort:${cohort}`);
}

async function writeJsonLine(stream, row) {
  if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain');
}

async function closeStream(stream) {
  stream.end();
  await once(stream, 'finish');
}

async function compressZstd(inputPath, outputPath) {
  const startedAt = Date.now();
  await execFileAsync(
    'zstd',
    ['--ultra', '-22', '--long=27', '-T0', '-q', '-f', inputPath, '-o', outputPath],
    { maxBuffer: 1024 * 1024 }
  );
  return Date.now() - startedAt;
}

async function sha256(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  await once(stream, 'end');
  return hash.digest('hex');
}

async function fileReceipt(path, compressionMs) {
  const info = await stat(path);
  return {
    name: path.split('/').at(-1),
    bytes: info.size,
    sha256: await sha256(path),
    compressionMs,
  };
}

function redditPermalink(post) {
  const permalink = String(post?.permalink || '');
  return permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
}

export function eventRow(post, subreddit, archiveDate, retrievedAt) {
  const sourceUrl = redditPermalink(post);
  const rawHash = createHash('sha256')
    .update(['reddit', subreddit, sourceUrl].join('␟'))
    .digest('hex');
  return {
    schemaVersion: 1,
    id: rawHash.slice(0, 16),
    source: `reddit:${subreddit}`,
    sourceUrl,
    publishedAt: new Date(Number(post?.created_utc || 0) * 1000).toISOString(),
    retrievedAt,
    title: String(post?.title || ''),
    content: String(post?.selftext || '').slice(0, 20_000) || null,
    rawHash,
    sourceClass: 'attention_aggregator',
    evidenceTier: 'derived',
    confidenceContribution: 'none',
    attentionContribution: 'allowed',
    attention: {
      score: Number(post?.score || 0),
      commentCount: Number(post?.num_comments || 0),
      upvoteRatio: post?.upvote_ratio ?? null,
      awardCount: Number(post?.total_awards_received || 0),
      flair: post?.link_flair_text ?? null,
      outboundUrl: post?.url ?? null,
    },
    archive: {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      date: archiveDate,
      postId: String(post?.id || ''),
      postObject: `reddit/v${ARCHIVE_SCHEMA_VERSION}/date=${archiveDate}/posts.jsonl.zst`,
      commentsObject: `reddit/v${ARCHIVE_SCHEMA_VERSION}/date=${archiveDate}/comments.jsonl.zst`,
      manifestObject: `reddit/v${ARCHIVE_SCHEMA_VERSION}/date=${archiveDate}/manifest.json`,
    },
  };
}

function createManifest({ communities, windowStart, windowEnd, results, totals, client, files }) {
  const partial = results.filter((result) => result.status === 'partial').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  return {
    schema: `high-signal.reddit-daily-archive.v${ARCHIVE_SCHEMA_VERSION}`,
    generatedAt: new Date().toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    status: partial || failed ? 'partial' : 'complete',
    requestedCommunities: communities.length,
    completedCommunities: communities.length - partial - failed,
    partialCommunities: partial,
    failedCommunities: failed,
    postCount: totals.posts,
    commentCount: totals.comments,
    commentsSeen: totals.commentsSeen,
    commentsDropped: totals.commentsDropped,
    eventCount: totals.events,
    requestMetrics: client.metrics,
    codec: { name: 'zstd', level: 22, longDistanceWindowLog: 27, dictionary: null },
    retentionPolicy: {
      posts: 'all posts returned inside the exact window from curated communities',
      comments: 'score threshold plus submitter, moderator, sticky and ancestor context',
      commentMinScore: COMMENT_MIN_SCORE,
      eventMinScore: EVENT_MIN_SCORE,
      eventMinComments: EVENT_MIN_COMMENTS,
    },
    schemas: {
      posts: POST_FIELDS,
      comments: COMMENT_FIELDS,
      events: 'high-signal.reddit-event.v1',
    },
    files,
    results,
  };
}

export async function runArchive({ communities, outputDir, windowStart, windowEnd, client }) {
  await mkdir(outputDir, { recursive: true });
  const postsPath = resolve(outputDir, 'posts.jsonl');
  const commentsPath = resolve(outputDir, 'comments.jsonl');
  const eventsPath = resolve(outputDir, 'events.jsonl');
  const postsCompressedPath = `${postsPath}.zst`;
  const commentsCompressedPath = `${commentsPath}.zst`;
  const eventsCompressedPath = `${eventsPath}.zst`;
  const manifestPath = resolve(outputDir, 'manifest.json');
  const indexPath = resolve(outputDir, 'subreddits.index.json');
  const latestPath = resolve(outputDir, 'latest.json');
  const postsStream = createWriteStream(postsPath);
  const commentsStream = createWriteStream(commentsPath);
  const eventsStream = createWriteStream(eventsPath);
  const results = [];
  const totals = { posts: 0, comments: 0, commentsSeen: 0, commentsDropped: 0, events: 0 };
  const archiveDate = windowEnd.toISOString().slice(0, 10);

  for (const subreddit of communities) {
    const result = {
      subreddit,
      status: 'complete',
      posts: 0,
      comments: 0,
      commentsSeen: 0,
      commentsDropped: 0,
      events: 0,
      postStartLine: totals.posts,
      commentStartLine: totals.comments,
      eventStartLine: totals.events,
      listingPages: 0,
      cutoffReached: false,
      listingCapped: false,
      commentFailures: 0,
      unresolvedMore: 0,
    };

    try {
      const listing = await collectListing({
        client,
        subreddit,
        windowStart,
        windowEnd,
        onPost: async (post) => {
          const retrievedAt = new Date().toISOString();
          await writeJsonLine(postsStream, postRow(post, subreddit, retrievedAt));
          result.posts += 1;
          totals.posts += 1;
          if (postQualifiesForEvent(post)) {
            await writeJsonLine(eventsStream, eventRow(post, subreddit, archiveDate, retrievedAt));
            result.events += 1;
            totals.events += 1;
          }
          if (Number(post.num_comments || 0) <= 0) return;

          try {
            const commentResult = await collectComments({
              client,
              postId: post.id,
              subreddit,
              retrievedAt,
              onComment: async (row) => {
                await writeJsonLine(commentsStream, row);
                result.comments += 1;
                totals.comments += 1;
              },
            });
            result.commentsSeen += commentResult.seen;
            totals.commentsSeen += commentResult.seen;
            result.commentsDropped += commentResult.filtered;
            totals.commentsDropped += commentResult.filtered;
            result.unresolvedMore += commentResult.unresolvedMore;
          } catch (error) {
            result.commentFailures += 1;
            result.status = 'partial';
            console.error(
              JSON.stringify({
                event: 'reddit_comment_failure',
                subreddit,
                postId: post.id,
                error: error instanceof Error ? error.message : 'unknown_error',
              })
            );
          }
        },
      });
      result.listingPages = listing.pages;
      result.cutoffReached = listing.cutoffReached;
      result.listingCapped = listing.listingCapped;
      if (listing.listingCapped || result.unresolvedMore > 0) result.status = 'partial';
    } catch (error) {
      result.status = 'failed';
      result.error = error instanceof Error ? error.message : 'unknown_error';
      result.permanent = Boolean(error?.permanent);
    }

    results.push(result);
    console.log(JSON.stringify({ event: 'reddit_subreddit_complete', ...result }));
  }

  await Promise.all([
    closeStream(postsStream),
    closeStream(commentsStream),
    closeStream(eventsStream),
  ]);
  const postsCompressionMs = await compressZstd(postsPath, postsCompressedPath);
  const commentsCompressionMs = await compressZstd(commentsPath, commentsCompressedPath);
  const eventsCompressionMs = await compressZstd(eventsPath, eventsCompressedPath);
  const files = await Promise.all([
    fileReceipt(postsCompressedPath, postsCompressionMs),
    fileReceipt(commentsCompressedPath, commentsCompressionMs),
    fileReceipt(eventsCompressedPath, eventsCompressionMs),
  ]);
  const manifest = createManifest({
    communities,
    windowStart,
    windowEnd,
    results,
    totals,
    client,
    files,
  });
  const subredditIndex = {
    schema: `high-signal.reddit-subreddit-index.v${ARCHIVE_SCHEMA_VERSION}`,
    archiveDate,
    streams: {
      posts: 'posts.jsonl.zst',
      comments: 'comments.jsonl.zst',
      events: 'events.jsonl.zst',
    },
    communities: Object.fromEntries(
      results.map((result) => [
        result.subreddit,
        {
          status: result.status,
          posts: { startLine: result.postStartLine, count: result.posts },
          comments: { startLine: result.commentStartLine, count: result.comments },
          events: { startLine: result.eventStartLine, count: result.events },
        },
      ])
    ),
  };
  const eventsFile = files.find((file) => file.name === 'events.jsonl.zst');
  const latest = {
    schema: 'high-signal.reddit-latest.v1',
    archiveSchemaVersion: ARCHIVE_SCHEMA_VERSION,
    archiveDate,
    windowStart: manifest.windowStart,
    windowEnd: manifest.windowEnd,
    status: manifest.status,
    requestedCommunities: manifest.requestedCommunities,
    eventCount: manifest.eventCount,
    objects: {
      events: `reddit/v${ARCHIVE_SCHEMA_VERSION}/date=${archiveDate}/events.jsonl.zst`,
      index: `reddit/v${ARCHIVE_SCHEMA_VERSION}/date=${archiveDate}/subreddits.index.json`,
      manifest: `reddit/v${ARCHIVE_SCHEMA_VERSION}/date=${archiveDate}/manifest.json`,
    },
    eventsSha256: eventsFile.sha256,
    eventsBytes: eventsFile.bytes,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(indexPath, `${JSON.stringify(subredditIndex, null, 2)}\n`);
  await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  console.log(
    JSON.stringify({ event: 'reddit_archive_complete', ...manifest, results: undefined })
  );
  return {
    manifest,
    manifestPath,
    indexPath,
    latestPath,
    postsCompressedPath,
    commentsCompressedPath,
    eventsCompressedPath,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node scripts/reddit-daily-archive.mjs [--cohort 10|all] [--output-dir PATH] [--window-end ISO] [--scheduled]'
    );
    return;
  }
  const communities = await loadCommunities(options.cohort);
  const { windowStart, windowEnd } = resolveWindow(options);
  const client = createRedditClient({
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    userAgent: process.env.REDDIT_USER_AGENT || USER_AGENT,
  });
  const receipt = await runArchive({
    communities,
    outputDir: options.outputDir,
    windowStart,
    windowEnd,
    client,
  });
  if (receipt.manifest.status !== 'complete') process.exitCode = 2;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
