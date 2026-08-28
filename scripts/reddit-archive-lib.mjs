import { setTimeout as sleep } from 'node:timers/promises';

export const POST_FIELDS = [
  'id',
  'subreddit',
  'title',
  'body',
  'url',
  'permalink',
  'author',
  'createdUtc',
  'edited',
  'score',
  'upvoteRatio',
  'commentCount',
  'awardCount',
  'flair',
  'nsfw',
  'spoiler',
  'stickied',
  'locked',
  'archived',
  'removalState',
  'distinguished',
  'domain',
];

export const COMMENT_FIELDS = [
  'id',
  'postId',
  'parentId',
  'subreddit',
  'author',
  'body',
  'createdUtc',
  'edited',
  'score',
  'controversiality',
  'distinguished',
  'stickied',
  'collapsed',
  'depth',
];

const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410, 451]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const MIN_REQUEST_INTERVAL_MS = 650;

export class RedditApiError extends Error {
  constructor(message, { status = 0, permanent = false } = {}) {
    super(message);
    this.name = 'RedditApiError';
    this.status = status;
    this.permanent = permanent;
  }
}

function nullable(value) {
  return value === undefined ? null : value;
}

export function postRow(post, fallbackSubreddit) {
  return [
    String(post?.id || ''),
    String(post?.subreddit || fallbackSubreddit),
    String(post?.title || ''),
    String(post?.selftext || ''),
    nullable(post?.url),
    nullable(post?.permalink),
    nullable(post?.author),
    Number(post?.created_utc || 0),
    nullable(post?.edited),
    Number(post?.score || 0),
    nullable(post?.upvote_ratio),
    Number(post?.num_comments || 0),
    Number(post?.total_awards_received || 0),
    nullable(post?.link_flair_text),
    Boolean(post?.over_18),
    Boolean(post?.spoiler),
    Boolean(post?.stickied),
    Boolean(post?.locked),
    Boolean(post?.archived),
    nullable(post?.removed_by_category),
    nullable(post?.distinguished),
    nullable(post?.domain),
  ];
}

export function commentRow(comment, subreddit, postId) {
  return [
    String(comment?.id || ''),
    String(comment?.link_id || `t3_${postId}`).replace(/^t3_/, ''),
    nullable(comment?.parent_id),
    String(comment?.subreddit || subreddit),
    nullable(comment?.author),
    String(comment?.body || ''),
    Number(comment?.created_utc || 0),
    nullable(comment?.edited),
    Number(comment?.score || 0),
    Number(comment?.controversiality || 0),
    nullable(comment?.distinguished),
    Boolean(comment?.stickied),
    Boolean(comment?.collapsed),
    nullable(comment?.depth),
  ];
}

export function flattenCommentThings(things, subreddit, postId) {
  const comments = [];
  const moreIds = [];

  function visit(entries) {
    for (const thing of entries || []) {
      if (thing?.kind === 't1' && thing.data?.id) {
        comments.push(commentRow(thing.data, subreddit, postId));
        const replies = thing.data?.replies?.data?.children;
        if (Array.isArray(replies)) visit(replies);
      } else if (thing?.kind === 'more' && Array.isArray(thing.data?.children)) {
        moreIds.push(...thing.data.children.filter(Boolean).map(String));
      }
    }
  }

  visit(things);
  return { comments, moreIds };
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (response.status === 429 && Number.isFinite(reset) && reset > 0) {
    return Math.min(reset * 1000, 60_000);
  }
  return Math.min(2 ** (attempt - 1) * 1000, 10_000);
}

export function createRedditClient({
  clientId,
  clientSecret,
  userAgent,
  fetcher = fetch,
  sleeper = sleep,
  now = () => Date.now(),
}) {
  if (!clientId || !clientSecret) throw new Error('missing_reddit_oauth_credentials');
  if (!userAgent) throw new Error('missing_reddit_user_agent');

  let token = null;
  let tokenExpiresAt = 0;
  let lastRequestStartedAt = 0;
  const metrics = { requests: 0, retries: 0, waitedMs: 0, remaining: null };

  async function throttle() {
    const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now() - lastRequestStartedAt));
    if (waitMs > 0) {
      metrics.waitedMs += waitMs;
      await sleeper(waitMs);
    }
    lastRequestStartedAt = now();
  }

  function observe(response) {
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(remaining) && remaining >= 0) metrics.remaining = remaining;
  }

  async function request(url, options = {}, authenticated = true) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const bearerToken = authenticated ? await accessToken() : null;
      await throttle();
      const headers = new Headers(options.headers || {});
      headers.set('user-agent', userAgent);
      headers.set('accept', 'application/json');
      if (bearerToken) headers.set('authorization', `Bearer ${bearerToken}`);

      const response = await fetcher(url, { ...options, headers });
      metrics.requests += 1;
      observe(response);
      if (response.ok) return response;

      const permanent = PERMANENT_STATUSES.has(response.status);
      const retryable = RETRYABLE_STATUSES.has(response.status);
      if (permanent || !retryable || attempt === MAX_ATTEMPTS) {
        throw new RedditApiError(`reddit_http_${response.status}`, {
          status: response.status,
          permanent,
        });
      }

      metrics.retries += 1;
      const waitMs = retryDelayMs(response, attempt);
      metrics.waitedMs += waitMs;
      await sleeper(waitMs);
    }
    throw new RedditApiError('reddit_request_failed');
  }

  async function accessToken() {
    if (token && now() < tokenExpiresAt - 60_000) return token;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await request(
      'https://www.reddit.com/api/v1/access_token',
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
      false
    );
    const payload = await response.json();
    if (typeof payload?.access_token !== 'string')
      throw new RedditApiError('oauth_invalid_response');
    token = payload.access_token;
    tokenExpiresAt = now() + Number(payload.expires_in || 3600) * 1000;
    return token;
  }

  async function getJson(path, params = {}) {
    const url = new URL(`https://oauth.reddit.com${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '')
        url.searchParams.set(key, String(value));
    }
    const response = await request(url);
    return response.json();
  }

  async function postForm(path, values) {
    const response = await request(`https://oauth.reddit.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    });
    return response.json();
  }

  return { accessToken, getJson, postForm, metrics };
}

export async function collectListing({ client, subreddit, windowStart, windowEnd, onPost }) {
  let after = null;
  let pages = 0;
  let cutoffReached = false;
  let listingCapped = false;
  let collected = 0;
  const seenPosts = new Set();

  while (pages < 10) {
    const payload = await client.getJson(`/r/${encodeURIComponent(subreddit)}/new`, {
      limit: 100,
      after,
      raw_json: 1,
    });
    pages += 1;
    const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
    const posts = children
      .map((item) => item?.data)
      .filter((post) => post?.id && post?.created_utc);

    for (const post of posts) {
      const createdAt = Number(post.created_utc) * 1000;
      if (
        !seenPosts.has(post.id) &&
        createdAt >= windowStart.getTime() &&
        createdAt < windowEnd.getTime()
      ) {
        seenPosts.add(post.id);
        await onPost(post);
        collected += 1;
      }
    }

    // Reddit's /new listing is reverse chronological. Use the final item rather
    // than the minimum timestamp so one old sticky cannot stop pagination.
    const lastCreatedAt = Number(posts.at(-1)?.created_utc || 0) * 1000;
    if (lastCreatedAt > 0 && lastCreatedAt <= windowStart.getTime()) {
      cutoffReached = true;
      break;
    }

    after = payload?.data?.after || null;
    if (!after || posts.length === 0) {
      cutoffReached = true;
      break;
    }
  }

  if (!cutoffReached) listingCapped = true;
  return { collected, pages, cutoffReached, listingCapped };
}

export async function collectComments({ client, postId, subreddit, onComment }) {
  const seenComments = new Set();
  const requestedMore = new Set();
  const queuedMore = [];
  let unresolvedMore = 0;
  let emitted = 0;

  async function ingest(things) {
    const flattened = flattenCommentThings(things, subreddit, postId);
    for (const row of flattened.comments) {
      const id = row[0];
      if (!id || seenComments.has(id)) continue;
      seenComments.add(id);
      await onComment(row);
      emitted += 1;
    }
    for (const id of flattened.moreIds) {
      if (!seenComments.has(id)) queuedMore.push(id);
    }
  }

  const payload = await client.getJson(`/comments/${encodeURIComponent(postId)}`, {
    limit: 500,
    depth: 10,
    raw_json: 1,
  });
  const listing = Array.isArray(payload) ? payload[1] : null;
  await ingest(listing?.data?.children || []);

  while (queuedMore.length > 0) {
    const batch = [...new Set(queuedMore.splice(0, 100))].filter(
      (id) => !seenComments.has(id) && !requestedMore.has(id)
    );
    if (batch.length === 0) continue;
    batch.forEach((id) => requestedMore.add(id));
    try {
      const morePayload = await client.postForm('/api/morechildren', {
        api_type: 'json',
        link_id: `t3_${postId}`,
        children: batch.join(','),
        raw_json: '1',
      });
      await ingest(morePayload?.json?.data?.things || []);
    } catch {
      unresolvedMore += batch.length;
    }
  }

  return { emitted, unresolvedMore };
}
