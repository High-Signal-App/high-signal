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
  COMMENT_FIELDS,
  POST_FIELDS,
  collectComments,
  collectListing,
  createRedditClient,
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
  if (cohort === 'all' || cohort === '200') return roster.communities;
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

export async function runArchive({ communities, outputDir, windowStart, windowEnd, client }) {
  await mkdir(outputDir, { recursive: true });
  const postsPath = resolve(outputDir, 'posts.jsonl');
  const commentsPath = resolve(outputDir, 'comments.jsonl');
  const postsCompressedPath = `${postsPath}.zst`;
  const commentsCompressedPath = `${commentsPath}.zst`;
  const manifestPath = resolve(outputDir, 'manifest.json');
  const postsStream = createWriteStream(postsPath);
  const commentsStream = createWriteStream(commentsPath);
  const results = [];
  let totalPosts = 0;
  let totalComments = 0;

  for (const subreddit of communities) {
    const result = {
      subreddit,
      status: 'complete',
      posts: 0,
      comments: 0,
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
          await writeJsonLine(postsStream, postRow(post, subreddit));
          result.posts += 1;
          totalPosts += 1;
          if (Number(post.num_comments || 0) <= 0) return;

          try {
            const commentResult = await collectComments({
              client,
              postId: post.id,
              subreddit,
              onComment: async (row) => {
                await writeJsonLine(commentsStream, row);
                result.comments += 1;
                totalComments += 1;
              },
            });
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

  await Promise.all([closeStream(postsStream), closeStream(commentsStream)]);
  // Zstd level 22 uses all available cores. Run the two packs serially so two
  // compressors do not contend on a small GitHub-hosted or personal runner.
  const postsCompressionMs = await compressZstd(postsPath, postsCompressedPath);
  const commentsCompressionMs = await compressZstd(commentsPath, commentsCompressedPath);
  const files = await Promise.all([
    fileReceipt(postsCompressedPath, postsCompressionMs),
    fileReceipt(commentsCompressedPath, commentsCompressionMs),
  ]);
  const partial = results.filter((result) => result.status === 'partial').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const manifest = {
    schema: 'high-signal.reddit-daily-archive.v1',
    generatedAt: new Date().toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    status: partial || failed ? 'partial' : 'complete',
    requestedCommunities: communities.length,
    completedCommunities: communities.length - partial - failed,
    partialCommunities: partial,
    failedCommunities: failed,
    postCount: totalPosts,
    commentCount: totalComments,
    requestMetrics: client.metrics,
    codec: {
      name: 'zstd',
      level: 22,
      longDistanceWindowLog: 27,
      dictionary: null,
    },
    schemas: { posts: POST_FIELDS, comments: COMMENT_FIELDS },
    files,
    results,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify({ event: 'reddit_archive_complete', ...manifest, results: undefined })
  );
  return { manifest, manifestPath, postsCompressedPath, commentsCompressedPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node scripts/reddit-daily-archive.mjs [--cohort 10|200] [--output-dir PATH] [--window-end ISO] [--scheduled]'
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
