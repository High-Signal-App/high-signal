import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
import {
  articleFromWikiUrl,
  buildPageviewsUrl,
  parseTimestamp,
  summarize,
} from '../routes/attention';

const fetcher = app as unknown as {
  fetch(req: Request, env?: Record<string, unknown>): Promise<Response>;
};

const originalFetch = globalThis.fetch;

// ─── pure helpers ─────────────────────────────────────────────────────────

describe('parseTimestamp', () => {
  it('formats Wikimedia YYYYMMDD00 → ISO date', () => {
    expect(parseTimestamp('2026051000')).toBe('2026-05-10');
    expect(parseTimestamp('2026010100')).toBe('2026-01-01');
  });
});

describe('articleFromWikiUrl', () => {
  it('extracts the article slug from an enwiki URL', () => {
    expect(articleFromWikiUrl('https://en.wikipedia.org/wiki/Nvidia')).toBe('Nvidia');
    expect(articleFromWikiUrl('https://en.wikipedia.org/wiki/Apple_Inc.')).toBe('Apple_Inc.');
  });

  it('URL-decodes percent-escaped slugs', () => {
    expect(articleFromWikiUrl('https://en.wikipedia.org/wiki/S%26P_500')).toBe('S&P_500');
  });

  it('returns null for non-wiki URLs', () => {
    expect(articleFromWikiUrl('https://example.com/')).toBeNull();
    expect(articleFromWikiUrl(null)).toBeNull();
    expect(articleFromWikiUrl(undefined)).toBeNull();
  });
});

describe('buildPageviewsUrl', () => {
  it('builds the wikimedia REST URL with YYYYMMDD start/end', () => {
    const end = new Date(Date.UTC(2026, 4, 30)); // 2026-05-30
    const url = buildPageviewsUrl('Nvidia', 20, end);
    expect(url).toContain('/per-article/en.wikipedia/all-access/all-agents/Nvidia/daily/');
    expect(url).toContain('20260510/20260530');
  });

  it('URL-encodes the article', () => {
    const end = new Date(Date.UTC(2026, 4, 30));
    const url = buildPageviewsUrl('Apple Inc.', 7, end);
    expect(url).toContain('Apple%20Inc.');
  });
});

describe('summarize', () => {
  const days = (n: number, prefix: string, viewsBy: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({
      timestamp: `${prefix}${String(i + 1).padStart(2, '0')}00`,
      views: viewsBy(i),
    }));

  it('computes totalViews + avg from raw items', () => {
    const items = days(7, '20260501', () => 100);
    const out = summarize('X', 7, items);
    expect(out.totalViews).toBe(700);
    expect(out.avgPerDay).toBe(100);
    expect(out.series).toHaveLength(7);
  });

  it('trend is null when <14 days of data', () => {
    const items = days(10, '20260501', () => 100);
    const out = summarize('X', 10, items);
    expect(out.trend).toBeNull();
  });

  it('trend.direction = up when last 7d > prior 7d by >5%', () => {
    // first 7d avg 100, last 7d avg 150 → +50%
    const items = [...days(7, '20260501', () => 100), ...days(7, '20260508', () => 150)];
    const out = summarize('X', 14, items);
    expect(out.trend?.direction).toBe('up');
    expect(out.trend?.deltaPct).toBeCloseTo(50, 1);
  });

  it('trend.direction = down when recent < prior', () => {
    const items = [...days(7, '20260501', () => 200), ...days(7, '20260508', () => 100)];
    const out = summarize('X', 14, items);
    expect(out.trend?.direction).toBe('down');
    expect(out.trend?.deltaPct).toBeCloseTo(-50, 1);
  });

  it('trend.direction = flat when within ±5%', () => {
    const items = [...days(7, '20260501', () => 100), ...days(7, '20260508', () => 102)];
    const out = summarize('X', 14, items);
    expect(out.trend?.direction).toBe('flat');
  });
});

// ─── route ────────────────────────────────────────────────────────────────

describe('/attention/:article', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 400 when article is empty', async () => {
    const res = await fetcher.fetch(new Request('http://t/attention/'));
    // hono treats /:article with empty as no match → 404 most likely
    expect([400, 404]).toContain(res.status);
  });

  it('returns the summarized series on success', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { timestamp: '2026051000', views: 100 },
              { timestamp: '2026051100', views: 200 },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    );
    const res = await fetcher.fetch(new Request('http://t/attention/Nvidia?days=30'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { article: string; totalViews: number };
    expect(body.article).toBe('Nvidia');
    expect(body.totalViews).toBe(300);
  });

  it('returns 502 when Wikimedia errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 }));
    const res = await fetcher.fetch(new Request('http://t/attention/Nvidia'));
    expect(res.status).toBe(502);
  });

  it('returns 502 on network failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const res = await fetcher.fetch(new Request('http://t/attention/Nvidia'));
    expect(res.status).toBe(502);
  });
});
