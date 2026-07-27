export interface ExternalMention {
  id: string;
  source: 'reddit' | 'hacker-news' | 'product-hunt';
  title: string | null;
  body: string | null;
  author: string | null;
  score: number | null;
  url: string;
  createdAt: string;
}

export async function searchExternalMentions(input: {
  brandName: string;
  aliases?: string[];
  days?: number;
}) {
  const aliases = input.aliases ?? [];
  const [reddit, hackerNews, productHunt] = await Promise.all([
    searchBrandOnReddit(input.brandName, aliases),
    searchBrandOnHackerNews(input.brandName, aliases, input.days ?? 30),
    searchProductHuntLaunches(input.brandName),
  ]);
  return {
    reddit,
    hackerNews,
    productHunt,
    total: reddit.length + hackerNews.length + productHunt.length,
  };
}

async function searchBrandOnReddit(brandName: string, aliases: string[]) {
  const mentions: ExternalMention[] = [];
  const seen = new Set<string>();
  for (const term of [brandName, ...aliases].filter(Boolean)) {
    try {
      const params = new URLSearchParams({
        q: `"${term}"`,
        sort: 'new',
        t: 'month',
        limit: '25',
        restrict_sr: '',
        type: 'link,comment',
      });
      const response = await fetch(`https://www.reddit.com/search.json?${params}`, {
        headers: { 'User-Agent': 'HighSignal/1.0 (signal monitor)' },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as {
        data?: { children?: Array<{ kind?: string; data?: Record<string, unknown> }> };
      };
      for (const child of data.data?.children ?? []) {
        const row = child.data ?? {};
        const id = `${row['id'] ?? ''}`;
        if (!id || seen.has(`reddit:${id}`)) continue;
        seen.add(`reddit:${id}`);
        const permalink = `${row['permalink'] ?? ''}`;
        const isComment = child.kind === 't1';
        mentions.push({
          id,
          source: 'reddit',
          title: isComment ? null : trim(row['title'], 240),
          body: isComment ? trim(row['body'], 500) : trim(row['selftext'], 500),
          author: trim(row['author'], 80),
          score: numberOrNull(row['score']),
          url: permalink
            ? `https://reddit.com${permalink}`
            : trim(row['url'], 500) || 'https://reddit.com',
          createdAt: new Date(Number(row['created_utc'] ?? 0) * 1000).toISOString(),
        });
      }
    } catch {
      // External monitors are opportunistic; one source should not break the sweep.
    }
  }
  return mentions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function searchBrandOnHackerNews(brandName: string, aliases: string[], days: number) {
  const mentions: ExternalMention[] = [];
  const seen = new Set<string>();
  const sinceTimestamp = Math.floor((Date.now() - days * 86_400_000) / 1000);
  for (const term of [brandName, ...aliases].filter(Boolean)) {
    try {
      const params = new URLSearchParams({
        query: `"${term}"`,
        hitsPerPage: '20',
        numericFilters: `created_at_i>${sinceTimestamp}`,
      });
      const response = await fetch(`https://hn.algolia.com/api/v1/search?${params}`);
      if (!response.ok) continue;
      const data = (await response.json()) as {
        hits?: Array<Record<string, unknown>>;
      };
      for (const hit of data.hits ?? []) {
        const id = `${hit['objectID'] ?? ''}`;
        if (!id || seen.has(`hn:${id}`)) continue;
        seen.add(`hn:${id}`);
        mentions.push({
          id,
          source: 'hacker-news',
          title: trim(hit['title'] ?? hit['story_title'], 240),
          body: trim(hit['comment_text'], 500),
          author: trim(hit['author'], 80),
          score: numberOrNull(hit['points']),
          url:
            trim(hit['url'] ?? hit['story_url'], 500) ||
            `https://news.ycombinator.com/item?id=${id}`,
          createdAt: trim(hit['created_at'], 80) || new Date().toISOString(),
        });
      }
    } catch {
      // Keep the monitor resilient.
    }
  }
  return mentions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function searchProductHuntLaunches(brandName: string) {
  try {
    const params = new URLSearchParams({
      query: `"${brandName}"`,
      tags: 'story',
      hitsPerPage: '20',
    });
    const response = await fetch(`https://hn.algolia.com/api/v1/search?${params}`);
    if (!response.ok) return [];
    const data = (await response.json()) as { hits?: Array<Record<string, unknown>> };
    return (data.hits ?? [])
      .filter((hit) => {
        const url = `${hit['url'] ?? ''}`.toLowerCase();
        const title = `${hit['title'] ?? ''}`.toLowerCase();
        return (
          url.includes('producthunt.com') ||
          title.includes('product hunt') ||
          title.includes('show hn')
        );
      })
      .map((hit): ExternalMention => {
        const id = `${hit['objectID'] ?? crypto.randomUUID()}`;
        return {
          id,
          source: 'product-hunt',
          title: trim(hit['title'], 240),
          body: null,
          author: trim(hit['author'], 80),
          score: numberOrNull(hit['points']),
          url: trim(hit['url'], 500) || `https://news.ycombinator.com/item?id=${id}`,
          createdAt: trim(hit['created_at'], 80) || new Date().toISOString(),
        };
      });
  } catch {
    return [];
  }
}

function trim(value: unknown, max: number): string | null {
  const text = `${value ?? ''}`.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
