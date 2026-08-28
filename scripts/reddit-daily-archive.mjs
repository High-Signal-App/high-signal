#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
  const options = { cohort: 'all', outputDir: DEFAULT_OUTPUT, scheduled: false, resume: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cohort') options.cohort = argv[++index];
    else if (argument === '--output-dir') options.outputDir = resolve(argv[++index]);
    else if (argument === '--window-end') options.windowEnd = new Date(argv[++index]);
    else if (argument === '--scheduled') options.scheduled = true;
    else if (argument === '--resume') options.resume = true;
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
  const line = `${JSON.stringify(row)}\n`;
  if (!stream.write(line)) await once(stream, 'drain');
  return Buffer.byteLength(line);
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

async function decompressZstd(inputPath, outputPath) {
  await execFileAsync('zstd', ['-d', '-q', '-f', inputPath, '-o', outputPath], {
    maxBuffer: 1024 * 1024,
  });
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
    ...(compressionMs === undefined ? {} : { compressionMs }),
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

function createManifest({
  communities,
  windowStart,
  windowEnd,
  results,
  totals,
  client,
  files,
  indexReceipt,
  resumeState,
}) {
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
    watermark: {
      id: createHash('sha256')
        .update(
          `${windowStart.toISOString()}\n${windowEnd.toISOString()}\n${communities.join('\n')}`
        )
        .digest('hex'),
      boundary: '[windowStart, windowEnd)',
      persistedIn: 'manifest.json',
    },
    deduplication: {
      key: 'stable Reddit ID',
      duplicatePosts: totals.duplicatePosts,
      duplicateComments: totals.duplicateComments,
    },
    resume: {
      attempt: (resumeState?.priorAttempt || 0) + 1,
      reusedCommunities: resumeState?.reusedCommunities || 0,
      recollectedCommunities: communities.length - (resumeState?.reusedCommunities || 0),
      priorGeneratedAt: resumeState?.priorGeneratedAt || null,
    },
    requestMetrics: {
      requests: (resumeState?.priorRequestMetrics?.requests || 0) + client.metrics.requests,
      retries: (resumeState?.priorRequestMetrics?.retries || 0) + client.metrics.retries,
      waitedMs: (resumeState?.priorRequestMetrics?.waitedMs || 0) + client.metrics.waitedMs,
      remaining: client.metrics.remaining,
    },
    codec: {
      name: 'zstd',
      level: 22,
      longDistanceWindowLog: 27,
      dictionary: null,
      frameIndex: {
        object: indexReceipt.name,
        rangeUnit: 'decoded JSONL lines and bytes',
        bytes: indexReceipt.bytes,
        sha256: indexReceipt.sha256,
      },
    },
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

function archivePaths(outputDir) {
  const postsPath = resolve(outputDir, 'posts.jsonl');
  const commentsPath = resolve(outputDir, 'comments.jsonl');
  const eventsPath = resolve(outputDir, 'events.jsonl');
  return {
    postsPath,
    commentsPath,
    eventsPath,
    postsCompressedPath: `${postsPath}.zst`,
    commentsCompressedPath: `${commentsPath}.zst`,
    eventsCompressedPath: `${eventsPath}.zst`,
    manifestPath: resolve(outputDir, 'manifest.json'),
    indexPath: resolve(outputDir, 'subreddits.index.json'),
    latestPath: resolve(outputDir, 'latest.json'),
  };
}

function initialCommunityResult(subreddit, totals) {
  return {
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
    postStartByte: totals.postBytes,
    commentStartByte: totals.commentBytes,
    eventStartByte: totals.eventBytes,
    postBytes: 0,
    commentBytes: 0,
    eventBytes: 0,
    duplicatePosts: 0,
    duplicateComments: 0,
    listingPages: 0,
    cutoffReached: false,
    listingCapped: false,
    commentFailures: 0,
    unresolvedMore: 0,
  };
}

async function collectPost(context, post) {
  const { archiveDate, client, seenCommentIds, seenPostIds, streams, subreddit, result, totals } =
    context;
  const postId = String(post?.id || '');
  if (!postId || seenPostIds.has(postId)) {
    result.duplicatePosts += 1;
    totals.duplicatePosts += 1;
    return;
  }
  seenPostIds.add(postId);
  const retrievedAt = new Date().toISOString();
  const postBytes = await writeJsonLine(streams.posts, postRow(post, subreddit, retrievedAt));
  result.posts += 1;
  totals.posts += 1;
  result.postBytes += postBytes;
  totals.postBytes += postBytes;
  if (postQualifiesForEvent(post)) {
    const eventBytes = await writeJsonLine(
      streams.events,
      eventRow(post, subreddit, archiveDate, retrievedAt)
    );
    result.events += 1;
    totals.events += 1;
    result.eventBytes += eventBytes;
    totals.eventBytes += eventBytes;
  }
  if (Number(post.num_comments || 0) <= 0) return;

  try {
    const commentResult = await collectComments({
      client,
      postId: post.id,
      subreddit,
      retrievedAt,
      onComment: async (row) => {
        const commentId = String(row[COMMENT_FIELDS.indexOf('id')] || '');
        if (!commentId || seenCommentIds.has(commentId)) {
          result.duplicateComments += 1;
          totals.duplicateComments += 1;
          return;
        }
        seenCommentIds.add(commentId);
        const commentBytes = await writeJsonLine(streams.comments, row);
        result.comments += 1;
        totals.comments += 1;
        result.commentBytes += commentBytes;
        totals.commentBytes += commentBytes;
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
}

async function collectCommunity(context, subreddit) {
  const {
    archiveDate,
    client,
    seenCommentIds,
    seenPostIds,
    streams,
    totals,
    windowStart,
    windowEnd,
  } = context;
  const result = initialCommunityResult(subreddit, totals);
  const postContext = {
    archiveDate,
    client,
    seenCommentIds,
    seenPostIds,
    streams,
    subreddit,
    result,
    totals,
  };

  try {
    const listing = await collectListing({
      client,
      subreddit,
      windowStart,
      windowEnd,
      onPost: (post) => collectPost(postContext, post),
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

  console.log(JSON.stringify({ event: 'reddit_subreddit_complete', ...result }));
  return result;
}

function createSubredditIndex(results, archiveDate) {
  return {
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
          decodedRanges: {
            posts: { startByte: result.postStartByte, bytes: result.postBytes },
            comments: { startByte: result.commentStartByte, bytes: result.commentBytes },
            events: { startByte: result.eventStartByte, bytes: result.eventBytes },
          },
        },
      ])
    ),
    access: {
      unit: 'decoded JSONL line and byte ranges',
      compressedStreams: 'single cross-community zstd frame',
    },
  };
}

function jsonLines(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rowsForResult(rows, result, kind) {
  const singular = kind === 'comments' ? 'comment' : kind.slice(0, -1);
  const start = Number(result[`${singular}StartLine`] || 0);
  const count = Number(result[kind === 'comments' ? 'comments' : kind] || 0);
  if (start < 0 || count < 0 || start + count > rows.length) {
    throw new Error(`resume_range_invalid:${result.subreddit}:${kind}`);
  }
  return rows.slice(start, start + count);
}

async function prepareResume({ communities, paths, windowStart, windowEnd }) {
  try {
    await access(paths.manifestPath);
  } catch {
    return null;
  }
  const manifest = JSON.parse(await readFile(paths.manifestPath, 'utf8'));
  if (
    manifest.windowStart !== windowStart.toISOString() ||
    manifest.windowEnd !== windowEnd.toISOString()
  ) {
    throw new Error('resume_window_mismatch');
  }
  const resultNames = (manifest.results || []).map((result) => result.subreddit);
  if (resultNames.some((name) => !communities.includes(name)))
    throw new Error('resume_roster_mismatch');
  await Promise.all([
    decompressZstd(paths.postsCompressedPath, paths.postsPath),
    decompressZstd(paths.commentsCompressedPath, paths.commentsPath),
    decompressZstd(paths.eventsCompressedPath, paths.eventsPath),
  ]);
  const [postRows, commentRows, eventRows] = await Promise.all([
    readFile(paths.postsPath, 'utf8').then(jsonLines),
    readFile(paths.commentsPath, 'utf8').then(jsonLines),
    readFile(paths.eventsPath, 'utf8').then(jsonLines),
  ]);
  const keptResults = [];
  const kept = { posts: [], comments: [], events: [] };
  const totals = {
    posts: 0,
    comments: 0,
    commentsSeen: 0,
    commentsDropped: 0,
    events: 0,
    postBytes: 0,
    commentBytes: 0,
    eventBytes: 0,
    duplicatePosts: Number(manifest.deduplication?.duplicatePosts || 0),
    duplicateComments: Number(manifest.deduplication?.duplicateComments || 0),
  };
  for (const previous of manifest.results || []) {
    if (previous.status !== 'complete') continue;
    const result = { ...previous };
    const communityPosts = rowsForResult(postRows, previous, 'posts');
    const communityComments = rowsForResult(commentRows, previous, 'comments');
    const communityEvents = rowsForResult(eventRows, previous, 'events');
    result.postStartLine = totals.posts;
    result.commentStartLine = totals.comments;
    result.eventStartLine = totals.events;
    result.postStartByte = totals.postBytes;
    result.commentStartByte = totals.commentBytes;
    result.eventStartByte = totals.eventBytes;
    result.postBytes = Buffer.byteLength(
      communityPosts.map((row) => JSON.stringify(row)).join('\n') +
        (communityPosts.length ? '\n' : '')
    );
    result.commentBytes = Buffer.byteLength(
      communityComments.map((row) => JSON.stringify(row)).join('\n') +
        (communityComments.length ? '\n' : '')
    );
    result.eventBytes = Buffer.byteLength(
      communityEvents.map((row) => JSON.stringify(row)).join('\n') +
        (communityEvents.length ? '\n' : '')
    );
    kept.posts.push(...communityPosts);
    kept.comments.push(...communityComments);
    kept.events.push(...communityEvents);
    totals.posts += result.posts;
    totals.comments += result.comments;
    totals.commentsSeen += result.commentsSeen;
    totals.commentsDropped += result.commentsDropped;
    totals.events += result.events;
    totals.postBytes += result.postBytes;
    totals.commentBytes += result.commentBytes;
    totals.eventBytes += result.eventBytes;
    keptResults.push(result);
  }
  await Promise.all(
    Object.entries(kept).map(([kind, rows]) =>
      writeFile(
        paths[`${kind}Path`],
        rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
      )
    )
  );
  return {
    keptResults,
    totals,
    seenPostIds: new Set(kept.posts.map((row) => String(row[POST_FIELDS.indexOf('id')]))),
    seenCommentIds: new Set(kept.comments.map((row) => String(row[COMMENT_FIELDS.indexOf('id')]))),
    priorAttempt: Number(manifest.resume?.attempt || 1),
    priorGeneratedAt: manifest.generatedAt,
    priorRequestMetrics: manifest.requestMetrics,
    reusedCommunities: keptResults.length,
  };
}

function createLatestPointer(manifest, archiveDate, files) {
  const eventsFile = files.find((file) => file.name === 'events.jsonl.zst');
  return {
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
}

async function finalizeArchive(context) {
  const {
    archiveDate,
    client,
    communities,
    paths,
    results,
    streams,
    totals,
    windowStart,
    windowEnd,
    resumeState,
  } = context;
  await Promise.all([
    closeStream(streams.posts),
    closeStream(streams.comments),
    closeStream(streams.events),
  ]);
  const compressionTimes = await Promise.all([
    compressZstd(paths.postsPath, paths.postsCompressedPath),
    compressZstd(paths.commentsPath, paths.commentsCompressedPath),
    compressZstd(paths.eventsPath, paths.eventsCompressedPath),
  ]);
  const files = await Promise.all([
    fileReceipt(paths.postsCompressedPath, compressionTimes[0]),
    fileReceipt(paths.commentsCompressedPath, compressionTimes[1]),
    fileReceipt(paths.eventsCompressedPath, compressionTimes[2]),
  ]);
  const subredditIndex = createSubredditIndex(results, archiveDate);
  await writeFile(paths.indexPath, `${JSON.stringify(subredditIndex, null, 2)}\n`);
  const indexReceipt = await fileReceipt(paths.indexPath);
  const manifest = createManifest({
    communities,
    windowStart,
    windowEnd,
    results,
    totals,
    client,
    files,
    indexReceipt,
    resumeState,
  });
  const latest = createLatestPointer(manifest, archiveDate, files);
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(paths.latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  console.log(
    JSON.stringify({ event: 'reddit_archive_complete', ...manifest, results: undefined })
  );
  return { manifest, ...paths };
}

export async function runArchive({
  communities,
  outputDir,
  windowStart,
  windowEnd,
  client,
  resume = false,
}) {
  await mkdir(outputDir, { recursive: true });
  const paths = archivePaths(outputDir);
  const resumeState = resume
    ? await prepareResume({ communities, paths, windowStart, windowEnd })
    : null;
  const streams = {
    posts: createWriteStream(paths.postsPath, { flags: resumeState ? 'a' : 'w' }),
    comments: createWriteStream(paths.commentsPath, { flags: resumeState ? 'a' : 'w' }),
    events: createWriteStream(paths.eventsPath, { flags: resumeState ? 'a' : 'w' }),
  };
  const totals = resumeState?.totals || {
    posts: 0,
    comments: 0,
    commentsSeen: 0,
    commentsDropped: 0,
    events: 0,
    postBytes: 0,
    commentBytes: 0,
    eventBytes: 0,
    duplicatePosts: 0,
    duplicateComments: 0,
  };
  const context = {
    archiveDate: windowEnd.toISOString().slice(0, 10),
    client,
    communities,
    paths,
    results: resumeState?.keptResults || [],
    resumeState,
    seenPostIds: resumeState?.seenPostIds || new Set(),
    seenCommentIds: resumeState?.seenCommentIds || new Set(),
    streams,
    totals,
    windowStart,
    windowEnd,
  };

  for (const subreddit of communities) {
    if (
      context.results.some(
        (result) => result.subreddit === subreddit && result.status === 'complete'
      )
    ) {
      console.log(JSON.stringify({ event: 'reddit_subreddit_reused', subreddit }));
      continue;
    }
    context.results.push(await collectCommunity(context, subreddit));
  }
  context.results.sort(
    (left, right) => communities.indexOf(left.subreddit) - communities.indexOf(right.subreddit)
  );
  return finalizeArchive(context);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node scripts/reddit-daily-archive.mjs [--cohort 10|all] [--output-dir PATH] [--window-end ISO] [--scheduled] [--resume]'
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
    resume: options.resume,
  });
  if (receipt.manifest.status !== 'complete') process.exitCode = 2;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
