import { Hono } from 'hono';
import { fetchRedditCommunity, searchRedditMentions } from '../lib/reddit';

export const communitiesRoute = new Hono();

communitiesRoute.get('/reddit/:subreddit', async (c) => {
  try {
    const community = await fetchRedditCommunity(c.req.param('subreddit'));
    return c.json({ community });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reddit_error';
    const status =
      message === 'reddit_not_found' ? 404 : message === 'reddit_rate_limited' ? 429 : 502;
    return c.json({ error: message }, status);
  }
});

communitiesRoute.get('/reddit-mentions', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ error: 'missing_query' }, 400);
  try {
    const result = await searchRedditMentions({
      query,
      sort: c.req.query('sort') === 'relevance' ? 'relevance' : 'new',
      timeFilter: ['day', 'week', 'month', 'year', 'all'].includes(c.req.query('t') ?? '')
        ? (c.req.query('t') as 'day' | 'week' | 'month' | 'year' | 'all')
        : 'month',
      limit: Number(c.req.query('limit') ?? 25),
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reddit_error';
    const status = message === 'reddit_rate_limited' ? 429 : 502;
    return c.json({ error: message }, status);
  }
});
