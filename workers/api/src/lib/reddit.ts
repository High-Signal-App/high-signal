const REDDIT_BASE = 'https://www.reddit.com';

export interface RedditCommunity {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  activeUsers: number | null;
  createdAt: string;
  nsfw: boolean;
  url: string;
}

export interface RedditMention {
  id: string;
  title: string | null;
  selftext: string | null;
  author: string;
  subreddit: string;
  score: number;
  comments: number;
  url: string;
  permalink: string;
  type: 'post' | 'comment';
  body: string | null;
  createdAt: string;
}

type RedditChild = {
  kind?: string;
  data?: Record<string, unknown>;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function redditJson<T>(path: string): Promise<T> {
  const res = await fetch(`${REDDIT_BASE}${path}`, {
    headers: { 'User-Agent': 'HighSignal/0.1 (signal intelligence platform)' },
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error('reddit_rate_limited');
    if (res.status === 404) throw new Error('reddit_not_found');
    throw new Error(`reddit_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchRedditCommunity(subreddit: string): Promise<RedditCommunity> {
  const data = await redditJson<{ data?: Record<string, unknown> }>(
    `/r/${encodeURIComponent(subreddit)}/about.json`
  );
  const raw = data.data ?? {};
  const displayName = asText(raw['display_name']) || subreddit;
  return {
    name: displayName,
    title: asText(raw['title']) || displayName,
    description: asText(raw['public_description']),
    subscribers: asNumber(raw['subscribers']),
    activeUsers: typeof raw['active_user_count'] === 'number' ? raw['active_user_count'] : null,
    createdAt: new Date(asNumber(raw['created_utc']) * 1000).toISOString(),
    nsfw: raw['over18'] === true,
    url: `https://reddit.com/r/${displayName}`,
  };
}

export async function searchRedditMentions(input: {
  query: string;
  sort?: 'relevance' | 'new';
  timeFilter?: 'day' | 'week' | 'month' | 'year' | 'all';
  limit?: number;
}): Promise<{ mentions: RedditMention[]; total: number }> {
  const params = new URLSearchParams({
    q: input.query,
    sort: input.sort ?? 'new',
    t: input.timeFilter ?? 'month',
    limit: String(Math.min(Math.max(input.limit ?? 25, 1), 100)),
    restrict_sr: '',
    type: 'link,comment',
  });
  const data = await redditJson<{ data?: { children?: RedditChild[]; dist?: number } }>(
    `/search.json?${params}`
  );
  const children = data.data?.children ?? [];
  const mentions = children.map((child) => {
    const raw = child.data ?? {};
    const isComment = child.kind === 't1';
    const permalink = asText(raw['permalink']);
    return {
      id: asText(raw['id']),
      title: isComment ? null : asText(raw['title']),
      selftext: isComment ? null : asText(raw['selftext']).slice(0, 500),
      author: asText(raw['author']),
      subreddit: asText(raw['subreddit']),
      score: asNumber(raw['score']),
      comments: asNumber(raw['num_comments']),
      url: isComment ? `https://reddit.com${permalink}` : asText(raw['url']),
      permalink: `https://reddit.com${permalink}`,
      type: isComment ? ('comment' as const) : ('post' as const),
      body: isComment ? asText(raw['body']).slice(0, 500) : null,
      createdAt: new Date(asNumber(raw['created_utc']) * 1000).toISOString(),
    };
  });
  return { mentions, total: data.data?.dist ?? mentions.length };
}
