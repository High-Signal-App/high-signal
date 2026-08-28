import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { COMMENT_FIELDS, POST_FIELDS } from './reddit-archive-lib.mjs';

const execFileAsync = promisify(execFile);
const STREAMS = ['posts', 'comments', 'events'];

function lines(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function lineText(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

async function sha256(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  await once(stream, 'end');
  return hash.digest('hex');
}

async function decompress(path, outputPath) {
  await execFileAsync('zstd', ['-d', '-q', '-f', path, '-o', outputPath]);
}

async function compress(path, outputPath) {
  const startedAt = Date.now();
  await execFileAsync('zstd', [
    '--ultra',
    '-22',
    '--long=27',
    '-T0',
    '-q',
    '-f',
    path,
    '-o',
    outputPath,
  ]);
  return Date.now() - startedAt;
}

async function receipt(path, compressionMs = null) {
  const info = await stat(path);
  return {
    name: path.split('/').at(-1),
    bytes: info.size,
    sha256: await sha256(path),
    ...(compressionMs === null ? {} : { compressionMs }),
  };
}

function rangeRows(rows, range, subreddit, stream, subredditAt) {
  const start = Number(range?.startLine || 0);
  const count = Number(range?.count || 0);
  const selected = rows.slice(start, start + count);
  if (selected.length !== count) throw new Error(`index_range_invalid:${subreddit}:${stream}`);
  if (
    selected.some(
      (row) => String(subredditAt(row)).toLowerCase() !== String(subreddit).toLowerCase()
    )
  ) {
    throw new Error(`index_subreddit_mismatch:${subreddit}:${stream}`);
  }
  return selected;
}

export function reconcileArchiveRows({ manifest, index, posts, comments, events }) {
  if (manifest.postCount !== posts.length) throw new Error('manifest_post_count_mismatch');
  if (manifest.commentCount !== comments.length) throw new Error('manifest_comment_count_mismatch');
  if (manifest.eventCount !== events.length) throw new Error('manifest_event_count_mismatch');
  const postIdAt = POST_FIELDS.indexOf('id');
  const postSubredditAt = POST_FIELDS.indexOf('subreddit');
  const commentIdAt = COMMENT_FIELDS.indexOf('id');
  const commentSubredditAt = COMMENT_FIELDS.indexOf('subreddit');
  if (new Set(posts.map((row) => row[postIdAt])).size !== posts.length)
    throw new Error('duplicate_post_id');
  if (new Set(comments.map((row) => row[commentIdAt])).size !== comments.length)
    throw new Error('duplicate_comment_id');
  if (new Set(events.map((row) => row.id)).size !== events.length)
    throw new Error('duplicate_event_id');
  for (const result of manifest.results || []) {
    const entry = index.communities?.[result.subreddit];
    if (!entry) throw new Error(`index_missing_community:${result.subreddit}`);
    rangeRows(posts, entry.posts, result.subreddit, 'posts', (row) => row[postSubredditAt]);
    rangeRows(
      comments,
      entry.comments,
      result.subreddit,
      'comments',
      (row) => row[commentSubredditAt]
    );
    rangeRows(events, entry.events, result.subreddit, 'events', (row) =>
      String(row.source || '').replace(/^reddit:/, '')
    );
  }
  return {
    status: 'healthy',
    coverageStatus: manifest.status,
    schema: manifest.schema,
    windowStart: manifest.windowStart,
    windowEnd: manifest.windowEnd,
    communities: manifest.requestedCommunities,
    completedCommunities: manifest.completedCommunities,
    partialCommunities: manifest.partialCommunities,
    failedCommunities: manifest.failedCommunities,
    posts: posts.length,
    comments: comments.length,
    events: events.length,
    unresolvedMore: (manifest.results || []).reduce(
      (sum, result) => sum + Number(result.unresolvedMore || 0),
      0
    ),
    listingCapped: (manifest.results || []).filter((result) => result.listingCapped).length,
    requests: Number(manifest.requestMetrics?.requests || 0),
    compressedBytes: (manifest.files || []).reduce((sum, file) => sum + Number(file.bytes || 0), 0),
  };
}

async function loadDecoded(outputDir) {
  const decoded = {};
  for (const stream of STREAMS) {
    const compressedPath = resolve(outputDir, `${stream}.jsonl.zst`);
    const path = resolve(outputDir, `${stream}.jsonl`);
    await decompress(compressedPath, path);
    decoded[stream] = lines(await readFile(path, 'utf8'));
  }
  return decoded;
}

export async function verifyArchive(outputDir, { verifyLatest = true } = {}) {
  const manifest = JSON.parse(await readFile(resolve(outputDir, 'manifest.json'), 'utf8'));
  const index = JSON.parse(await readFile(resolve(outputDir, 'subreddits.index.json'), 'utf8'));
  if (manifest.codec?.frameIndex) {
    const actualIndex = await receipt(resolve(outputDir, 'subreddits.index.json'));
    if (actualIndex.bytes !== manifest.codec.frameIndex.bytes)
      throw new Error('index_bytes_mismatch');
    if (actualIndex.sha256 !== manifest.codec.frameIndex.sha256)
      throw new Error('index_hash_mismatch');
  }
  for (const expected of manifest.files || []) {
    const actual = await receipt(resolve(outputDir, expected.name));
    if (actual.bytes !== expected.bytes) throw new Error(`file_bytes_mismatch:${expected.name}`);
    if (actual.sha256 !== expected.sha256) throw new Error(`file_hash_mismatch:${expected.name}`);
  }
  const decoded = await loadDecoded(outputDir);
  const health = reconcileArchiveRows({ manifest, index, ...decoded });
  if (verifyLatest) {
    const latest = JSON.parse(await readFile(resolve(outputDir, 'latest.json'), 'utf8'));
    const events = manifest.files.find((file) => file.name === 'events.jsonl.zst');
    if (
      latest.windowStart !== manifest.windowStart ||
      latest.windowEnd !== manifest.windowEnd ||
      latest.eventCount !== manifest.eventCount ||
      latest.eventsSha256 !== events?.sha256 ||
      latest.eventsBytes !== events?.bytes
    ) {
      throw new Error('latest_pointer_mismatch');
    }
  }
  return health;
}

function redactionHash(kind, id) {
  return createHash('sha256').update(`${kind}:${id}`).digest('hex');
}

export function redactArchiveRows({ posts, comments, events, postIds, commentIds }) {
  const postIdAt = POST_FIELDS.indexOf('id');
  const postTitleAt = POST_FIELDS.indexOf('title');
  const postBodyAt = POST_FIELDS.indexOf('body');
  const postUrlAt = POST_FIELDS.indexOf('url');
  const postAuthorAt = POST_FIELDS.indexOf('author');
  const postRemovalAt = POST_FIELDS.indexOf('removalState');
  const postHashAt = POST_FIELDS.indexOf('rawPayloadHash');
  const commentIdAt = COMMENT_FIELDS.indexOf('id');
  const commentAuthorAt = COMMENT_FIELDS.indexOf('author');
  const commentBodyAt = COMMENT_FIELDS.indexOf('body');
  const commentRemovalAt = COMMENT_FIELDS.indexOf('removalState');
  const commentHashAt = COMMENT_FIELDS.indexOf('rawPayloadHash');
  let redactedPosts = 0;
  let redactedComments = 0;
  const nextPosts = posts.map((input) => {
    const row = [...input];
    if (!postIds.has(String(row[postIdAt]))) return row;
    row[postTitleAt] = '[redacted]';
    row[postBodyAt] = '[redacted]';
    row[postUrlAt] = null;
    row[postAuthorAt] = null;
    row[postRemovalAt] = 'operator_redaction';
    row[postHashAt] = createHash('sha256')
      .update(JSON.stringify(row.slice(0, -1)))
      .digest('hex');
    redactedPosts += 1;
    return row;
  });
  const nextComments = comments.map((input) => {
    const row = [...input];
    if (!commentIds.has(String(row[commentIdAt]))) return row;
    row[commentAuthorAt] = null;
    row[commentBodyAt] = '[redacted]';
    row[commentRemovalAt] = 'operator_redaction';
    row[commentHashAt] = createHash('sha256')
      .update(JSON.stringify(row.slice(0, -1)))
      .digest('hex');
    redactedComments += 1;
    return row;
  });
  const nextEvents = events.filter((event) => !postIds.has(String(event.archive?.postId || '')));
  return {
    posts: nextPosts,
    comments: nextComments,
    events: nextEvents,
    redactedPosts,
    redactedComments,
    removedEvents: events.length - nextEvents.length,
  };
}

function rebuildEventRanges(manifest, index, events) {
  let startLine = 0;
  for (const result of manifest.results || []) {
    const count = events.filter(
      (event) => String(event.source || '').replace(/^reddit:/, '') === result.subreddit
    ).length;
    result.events = count;
    result.eventStartLine = startLine;
    if (index.communities?.[result.subreddit]) {
      index.communities[result.subreddit].events = { startLine, count };
    }
    startLine += count;
  }
  manifest.eventCount = events.length;
}

function rebuildDecodedRanges(manifest, index, decoded) {
  const streamCounts = { posts: 'posts', comments: 'comments', events: 'events' };
  for (const [stream, countField] of Object.entries(streamCounts)) {
    let startByte = 0;
    for (const result of manifest.results || []) {
      const entry = index.communities[result.subreddit];
      const selected = decoded[stream].slice(
        entry[stream].startLine,
        entry[stream].startLine + entry[stream].count
      );
      const bytes = Buffer.byteLength(lineText(selected));
      entry.decodedRanges ||= {};
      entry.decodedRanges[stream] = { startByte, bytes };
      const singular = stream === 'comments' ? 'comment' : stream.slice(0, -1);
      result[`${singular}StartByte`] = startByte;
      result[`${singular}Bytes`] = bytes;
      if (Number(result[countField] || 0) !== selected.length) {
        throw new Error(`result_count_mismatch:${result.subreddit}:${stream}`);
      }
      startByte += bytes;
    }
  }
}

export async function redactArchive(outputDir, { postIds, commentIds, reasonCode }) {
  const manifestPath = resolve(outputDir, 'manifest.json');
  const indexPath = resolve(outputDir, 'subreddits.index.json');
  const latestPath = resolve(outputDir, 'latest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const decoded = await loadDecoded(outputDir);
  reconcileArchiveRows({ manifest, index, ...decoded });
  const redacted = redactArchiveRows({ ...decoded, postIds, commentIds });
  if (redacted.redactedPosts !== postIds.size || redacted.redactedComments !== commentIds.size) {
    throw new Error('redaction_target_not_found');
  }
  for (const stream of STREAMS) {
    await writeFile(resolve(outputDir, `${stream}.jsonl`), lineText(redacted[stream]));
  }
  const compressionMs = await Promise.all(
    STREAMS.map((stream) =>
      compress(resolve(outputDir, `${stream}.jsonl`), resolve(outputDir, `${stream}.jsonl.zst`))
    )
  );
  manifest.files = await Promise.all(
    STREAMS.map((stream, index) =>
      receipt(resolve(outputDir, `${stream}.jsonl.zst`), compressionMs[index])
    )
  );
  rebuildEventRanges(manifest, index, redacted.events);
  rebuildDecodedRanges(manifest, index, redacted);
  manifest.generatedAt = new Date().toISOString();
  manifest.redactions = [
    ...(manifest.redactions || []),
    {
      appliedAt: manifest.generatedAt,
      reasonCode,
      postIdHashes: [...postIds].map((id) => redactionHash('post', id)),
      commentIdHashes: [...commentIds].map((id) => redactionHash('comment', id)),
      redactedPosts: redacted.redactedPosts,
      redactedComments: redacted.redactedComments,
      removedEvents: redacted.removedEvents,
    },
  ];
  const eventsFile = manifest.files.find((file) => file.name === 'events.jsonl.zst');
  const latest = JSON.parse(await readFile(latestPath, 'utf8'));
  const updatesLatest = latest.archiveDate === manifest.windowEnd.slice(0, 10);
  if (updatesLatest) {
    latest.eventCount = manifest.eventCount;
    latest.eventsSha256 = eventsFile.sha256;
    latest.eventsBytes = eventsFile.bytes;
  }
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const indexReceipt = await receipt(indexPath);
  manifest.codec.frameIndex = {
    object: 'subreddits.index.json',
    rangeUnit: 'decoded JSONL lines and bytes',
    bytes: indexReceipt.bytes,
    sha256: indexReceipt.sha256,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (updatesLatest) await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  await verifyArchive(outputDir, { verifyLatest: updatesLatest });
  return { ...redacted, updatesLatest };
}
