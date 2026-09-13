import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tryGetPrecomputedSnapshot: vi.fn(),
  buildStocks: vi.fn(
    async (_database?: unknown, _countries?: string[], _publicationDay?: string) => []
  ),
  buildIdeas: vi.fn(async (): Promise<BriefSnapshot['ideas']> => []),
  buildTrends: vi.fn(async () => []),
  buildDiggAttention: vi.fn(async () => ({
    attentionLeaders: [],
    emergingBeforeMainstream: [],
    attentionEvidenceGaps: [],
  })),
  buildNews: vi.fn(async (): Promise<NonNullable<BriefSnapshot['news']>> => []),
  buildPerception: vi.fn(async () => []),
  buildImprovements: vi.fn(async () => []),
  buildWatching: vi.fn(async () => []),
  buildIntentBriefItems: vi.fn(async () => []),
  insertBriefSnapshot: vi.fn(async () => undefined),
}));

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return {
    ...actual,
    db: () => ({
      mocked: true,
      insert: () => ({
        values: () => ({ onConflictDoUpdate: mocks.insertBriefSnapshot }),
      }),
    }),
  };
});

vi.mock('../routes/brief/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/brief/query')>();
  return {
    ...actual,
    tryGetPrecomputedSnapshot: mocks.tryGetPrecomputedSnapshot,
    buildStocks: mocks.buildStocks,
    buildIdeas: mocks.buildIdeas,
    buildTrends: mocks.buildTrends,
    buildDiggAttention: mocks.buildDiggAttention,
    buildNews: mocks.buildNews,
    buildPerception: mocks.buildPerception,
    buildImprovements: mocks.buildImprovements,
    buildWatching: mocks.buildWatching,
    buildIntentBriefItems: mocks.buildIntentBriefItems,
  };
});

import { briefRoute, parseDailyBriefRequest, safeCategory } from '../routes/brief';
import { dailySignalEdition, precomputeBriefSnapshots } from '../routes/brief/route';
import { istDay, type BriefSnapshot } from '@high-signal/shared';
import { createHistoryGrant } from '../lib/history-access';

const env = { DB: {} as D1Database };

describe('parseDailyBriefRequest', () => {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.get('/', (c) => c.json(parseDailyBriefRequest(c)));

  it('defaults to the global public edition', async () => {
    const response = await app.request('http://test/');
    await expect(response.json()).resolves.toEqual({
      region: 'global',
      archiveDate: null,
    });
  });

  it('keeps a valid archive date and unknown regions fall back to global', async () => {
    const response = await app.request(
      'http://test/?region=not-a-region&date=2026-01-02&product=ignored'
    );
    await expect(response.json()).resolves.toEqual({
      region: 'global',
      archiveDate: '2026-01-02',
    });
  });

  // There is no per-user brief variant any more, so `owner` must not survive
  // into the request shape — if it did it would fragment the edge cache.
  it('ignores a legacy owner parameter', async () => {
    const response = await app.request('http://test/?owner=user-1');
    await expect(response.json()).resolves.toEqual({
      region: 'global',
      archiveDate: null,
    });
  });
});

describe('GET /daily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue(null);
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue(null);
    mocks.buildStocks.mockResolvedValue([]);
    mocks.buildIdeas.mockResolvedValue([]);
    mocks.buildTrends.mockResolvedValue([]);
    mocks.buildDiggAttention.mockResolvedValue({
      attentionLeaders: [],
      emergingBeforeMainstream: [],
      attentionEvidenceGaps: [],
    });
    mocks.buildNews.mockResolvedValue([]);
  });

  it('requires verification before reading an older archive date', async () => {
    const response = await briefRoute.request('http://test/daily?date=2020-01-01', {}, env);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'history_verification_required',
    });
    expect(mocks.buildStocks).not.toHaveBeenCalled();
  });

  it('returns 404 after a verified older date has no snapshot', async () => {
    const secret = 'test-history-secret';
    const { grant } = await createHistoryGrant(secret);
    const response = await briefRoute.request(
      'http://test/daily?date=2020-01-01',
      { headers: { Authorization: `Bearer ${grant}` } },
      { ...env, TURNSTILE_SECRET: secret }
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'no_brief_for_date',
      date: '2020-01-01',
      region: 'global',
    });
  });

  it('composes live public sections when the cache misses', async () => {
    const stock = {
      ticker: 'NVDA',
      publishedAt: new Date().toISOString(),
      whatChanged: 'The company announced a capacity expansion.',
      whyItMatters: 'The expansion increases available production capacity.',
      uncertainty: 'The completion date remains subject to permitting.',
      evidenceUrls: [
        { url: 'https://primary.example/a' },
        { url: 'https://independent.example/a' },
      ],
      provenance: { primaryCount: 1, corroborationCount: 1, contradictionCount: 0 },
    };
    mocks.buildStocks.mockResolvedValue([stock] as never);
    mocks.buildIdeas.mockRejectedValue(new Error('ideas down'));
    mocks.buildTrends.mockResolvedValue([]);
    mocks.buildDiggAttention.mockResolvedValue({
      attentionLeaders: [{ shortId: 'digg-1' }],
      emergingBeforeMainstream: [{ shortId: 'digg-2' }],
      attentionEvidenceGaps: [{ id: 'digg-3' }],
    } as never);

    const response = await briefRoute.request('http://test/daily?region=north-america', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      region: string;
      stocks: unknown[];
      ideas: unknown[];
      attentionLeaders: unknown[];
      emergingBeforeMainstream: unknown[];
      attentionEvidenceGaps: unknown[];
      categoryStates: Record<string, { status: string; reason: string | null }>;
    };
    expect(body.region).toBe('north-america');
    expect(body.stocks).toEqual([stock]);
    expect(body.ideas).toEqual([]);
    expect(body.attentionLeaders).toEqual([{ shortId: 'digg-1' }]);
    expect(body.emergingBeforeMainstream).toEqual([{ shortId: 'digg-2' }]);
    expect(body.attentionEvidenceGaps).toEqual([{ id: 'digg-3' }]);
    expect(body.categoryStates['stocks']).toMatchObject({ status: 'ready' });
    expect(body.categoryStates['ideas']).toMatchObject({
      status: 'unavailable',
      reason: 'builder_failed',
    });
    expect(body.categoryStates['trends']).toMatchObject({
      status: 'empty',
      reason: 'no_qualifying_items',
    });
    expect(mocks.buildStocks).toHaveBeenCalled();
  });

  it('withholds unsupported ideas from fresh composition, not only cached snapshots', async () => {
    mocks.buildIdeas.mockResolvedValue([
      {
        title: 'Seeded hypothesis',
        description: 'A seeded claim about customer demand.',
        whyNow: 'Five product pages were collected.',
        source: 'opportunity',
        region: 'global',
        subreddit: null,
        surfacedAt: new Date().toISOString(),
        evidenceUrls: [{ url: 'https://marketplace.example/product' }],
      },
    ]);
    const response = await briefRoute.request('http://test/daily', {}, env);
    const body = (await response.json()) as BriefSnapshot;
    expect(body.ideas).toEqual([]);
    expect(body.categoryStates?.ideas).toMatchObject({
      status: 'empty',
      reason: 'items_withheld_by_publish_gate',
    });
    expect(body.publishStatus).toBe('pending');
  });

  it('marks a live-composed brief as pending with nextExpectedPublishAt', async () => {
    const stock = {
      ticker: 'NVDA',
      publishedAt: new Date().toISOString(),
      whatChanged: 'The company announced a capacity expansion.',
      whyItMatters: 'The expansion increases available production capacity.',
      uncertainty: 'The completion date remains subject to permitting.',
      evidenceUrls: [
        { url: 'https://primary.example/a' },
        { url: 'https://independent.example/a' },
      ],
      provenance: { primaryCount: 1, corroborationCount: 1, contradictionCount: 0 },
    };
    mocks.buildStocks.mockResolvedValue([stock] as never);

    const response = await briefRoute.request('http://test/daily', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      publishStatus: string;
      nextExpectedPublishAt: string;
    };
    expect(body.publishStatus).toBe('pending');
    expect(body.nextExpectedPublishAt).toBeTruthy();
    // Should be an ISO timestamp at 03:30 UTC
    expect(body.nextExpectedPublishAt).toMatch(/^20\d{2}-\d{2}-\d{2}T03:30:00/);
  });

  it('reads signals published after yesterday snapshot was computed', async () => {
    const day = istDay(new Date(), -1);
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue({
      generatedAt: `${day}T03:30:00Z`,
      region: 'global',
      stocks: [],
      ideas: [],
      trends: [],
    });
    mocks.buildStocks.mockResolvedValue([
      {
        entityName: 'Test Corp',
        signalSlug: 'late-publication',
        publishedAt: `${day}T04:00:00Z`,
        whatChanged: 'Test Corp announced a new product launch today.',
        whyItMatters: 'This expands their market reach significantly.',
        uncertainty: 'No material uncertainty was identified.',
        provenance: { primaryCount: 2, corroborationCount: 1, contradictionCount: 0 },
        evidenceUrls: [{ url: 'https://example.com/1' }, { url: 'https://example.org/2' }],
      },
    ] as never);
    const response = await briefRoute.request(`http://test/daily?date=${day}`, {}, env);
    const body = (await response.json()) as BriefSnapshot;
    expect(body.stocks.map((item) => item.signalSlug)).toEqual(['late-publication']);
    expect(mocks.buildStocks).toHaveBeenCalledWith(expect.anything(), [], day);
  });

  it('does not reuse cached signals when the public ledger read fails', async () => {
    const day = istDay(new Date(), -1);
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue({
      generatedAt: `${day}T03:30:00Z`,
      region: 'global',
      stocks: [{ signalSlug: 'stale', publishedAt: `${day}T03:00:00Z` }],
      ideas: [],
      trends: [],
    });
    mocks.buildStocks.mockRejectedValue(new Error('ledger unavailable'));
    const response = await briefRoute.request(`http://test/daily?date=${day}`, {}, env);
    const body = (await response.json()) as BriefSnapshot;
    expect(body.stocks).toEqual([]);
    expect(body.categoryStates?.stocks.status).toBe('unavailable');
  });

  it('does not call a cached edition published after its only section becomes empty', async () => {
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue({
      generatedAt: '2026-09-06T03:31:00.000Z',
      region: 'global',
      stocks: [
        {
          entityName: 'Test Corp',
          whatChanged: 'Test Corp announced a new product launch today.',
          whyItMatters: 'This expands their market reach significantly.',
          uncertainty: 'No material uncertainty was identified.',
          provenance: { primaryCount: 2, corroborationCount: 1, contradictionCount: 0 },
          evidenceUrls: [
            { url: 'https://example.com/1', label: 'Source 1' },
            { url: 'https://example.com/2', label: 'Source 2' },
          ],
        },
      ],
      ideas: [],
      trends: [],
      categoryStates: {
        stocks: { status: 'ready', source: 'precomputed', reason: null },
        ideas: { status: 'empty', source: 'precomputed', reason: 'no_qualifying_items' },
        trends: { status: 'empty', source: 'precomputed', reason: 'no_qualifying_items' },
      },
    });

    const response = await briefRoute.request('http://test/daily', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      publishStatus: string;
      nextExpectedPublishAt?: string;
    };
    expect(body.publishStatus).toBe('pending');
    expect(body.nextExpectedPublishAt).toBeUndefined();
  });

  it('returns ready news when market signals are empty or pending', async () => {
    const news = [
      {
        id: 'news-1',
        title: 'Issuer announces a capacity expansion',
        summary: 'The issuer announced a capacity expansion in a retained filing excerpt.',
        event_at: '2026-09-12T08:00:00.000Z',
        what_changed: '',
        source_references: [{ url: 'https://sec.gov/archives/example', source: 'edgar' }],
        evidence_status: 'official' as const,
      },
    ];
    mocks.buildNews.mockResolvedValue(news);
    const response = await briefRoute.request('http://test/daily', {}, env);
    const body = (await response.json()) as BriefSnapshot & { publishStatus: string };
    expect(body.stocks).toEqual([]);
    expect(body.news).toEqual(news);
    expect(body.publishStatus).toBe('pending');
    expect(mocks.buildNews).toHaveBeenCalled();
  });

  it('refreshes news for a cached public edition even when its morning snapshot was empty', async () => {
    const day = istDay(new Date(), -1);
    const news = [
      {
        id: 'news-late',
        title: 'Issuer reports an afternoon capacity expansion',
        summary: 'The retained report records the expansion and its announced timetable.',
        event_at: `${day}T12:00:00.000Z`,
        what_changed: '',
        source_references: [{ url: 'https://news.example/afternoon', source: 'news' }],
        evidence_status: 'reported' as const,
      },
    ];
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue({
      generatedAt: `${day}T03:30:00.000Z`,
      region: 'global',
      stocks: [],
      ideas: [],
      trends: [],
      news: [],
    });
    mocks.buildNews.mockResolvedValue(news);

    const response = await briefRoute.request(`http://test/daily?date=${day}`, {}, env);
    const body = (await response.json()) as BriefSnapshot & { publishStatus: string };
    expect(body.news).toEqual(news);
    expect(body.publishStatus).toBe('published');
    expect(mocks.buildNews).toHaveBeenCalledWith(expect.anything(), 'global', day);
  });

  it('preserves cached news when a live refresh fails', async () => {
    const day = istDay(new Date(), -1);
    const cachedNews = [
      {
        id: 'news-cached',
        title: 'Issuer confirms a retained product launch',
        summary: 'The cached report records the launch and the public release timetable.',
        event_at: `${day}T08:00:00.000Z`,
        what_changed: '',
        source_references: [{ url: 'https://issuer.example/launch', source: 'ir' }],
        evidence_status: 'official' as const,
      },
    ];
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue({
      generatedAt: `${day}T03:30:00.000Z`,
      region: 'global',
      stocks: [],
      ideas: [],
      trends: [],
      news: cachedNews,
    });
    mocks.buildNews.mockRejectedValue(new Error('D1 timeout'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await briefRoute.request(`http://test/daily?date=${day}`, {}, env);
    const body = (await response.json()) as BriefSnapshot;
    expect(body.news).toEqual(cachedNews);
    warn.mockRestore();
  });
});

describe('brief precompute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildStocks.mockResolvedValue([]);
    mocks.buildIdeas.mockResolvedValue([]);
    mocks.buildTrends.mockResolvedValue([]);
    mocks.buildDiggAttention.mockResolvedValue({
      attentionLeaders: [],
      emergingBeforeMainstream: [],
      attentionEvidenceGaps: [],
    });
    mocks.buildNews.mockResolvedValue([
      {
        id: 'news-1',
        title: 'Regulator publishes a retained daily update',
        summary: 'The retained update describes the decision and its effective timetable.',
        event_at: new Date().toISOString(),
        what_changed: '',
        source_references: [{ url: 'https://regulator.example/update', source: 'gov' }],
        evidence_status: 'official',
      },
    ]);
  });

  it('stores a news-only edition and scopes stock reads to its exact IST day', async () => {
    const result = await precomputeBriefSnapshots(env);
    expect(result.globalPublished).toBe(true);
    expect(mocks.insertBriefSnapshot).toHaveBeenCalledTimes(5);
    expect(mocks.buildStocks).toHaveBeenCalledTimes(5);
    for (const call of mocks.buildStocks.mock.calls) expect(call[2]).toBe(result.date);
  });

  it('reuses a sanitized current edition when an incremental news rebuild is empty', async () => {
    mocks.buildNews.mockResolvedValue([]);
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      region: 'global',
      stocks: [],
      ideas: [],
      trends: [],
      news: [
        {
          id: 'good-news',
          title: 'OpenAI launches a verified enterprise API',
          summary:
            'OpenAI launched a verified enterprise API with a documented release date and customer scope.',
          event_at: new Date().toISOString(),
          what_changed: '',
          source_references: [{ url: 'https://openai.example/api', source: 'news' }],
          evidence_status: 'reported',
        },
        {
          id: 'stock-pick',
          title: 'Top stocks to buy under ₹200',
          summary: 'This cached article recommends shares, price targets, and stop-loss levels.',
          event_at: new Date().toISOString(),
          what_changed: '',
          source_references: [{ url: 'https://example.com/stock-picks', source: 'news' }],
          evidence_status: 'reported',
        },
      ],
    });

    const result = await precomputeBriefSnapshots(env);
    expect(result.globalPublished).toBe(true);
    expect(result.regions[0]?.counts?.news).toBe(1);
  });
});

describe('safeCategory', () => {
  it('marks a thrown builder unavailable instead of substituting demo items', async () => {
    const result = await safeCategory(async () => {
      throw new Error('d1 timeout');
    }, 'stocks');
    expect(result).toEqual({
      items: [],
      state: { status: 'unavailable', source: 'live', reason: 'builder_failed' },
    });
  });
});

describe('daily signal edition', () => {
  const snapshot = {
    generatedAt: '2026-09-07T06:30:00Z',
    region: 'global',
    stocks: [
      { signalSlug: 'old', publishedAt: '2026-09-06T18:29:59Z' },
      { signalSlug: 'start', publishedAt: '2026-09-06T18:30:00Z' },
      { signalSlug: 'end', publishedAt: '2026-09-07T18:29:59Z' },
      { signalSlug: 'tomorrow', publishedAt: '2026-09-07T18:30:00Z' },
      { signalSlug: 'undated' },
    ],
    ideas: [],
    trends: [],
    categoryStates: {
      stocks: { status: 'ready', source: 'live' },
      ideas: { status: 'empty', source: 'live' },
      trends: { status: 'empty', source: 'live' },
    },
  } as unknown as BriefSnapshot;

  it('uses IST publication boundaries and never refreshes old or undated claims', () => {
    const result = dailySignalEdition(snapshot, '2026-09-07');
    expect(result.stocks.map((item) => item.signalSlug)).toEqual(['start', 'end']);
    expect(result.editionDate).toBe('2026-09-07');
    expect(result.timeZone).toBe('Asia/Kolkata');
    expect(snapshot.stocks).toHaveLength(5);
  });

  it('reports no qualifying items when a rolling snapshot only has older signals', () => {
    const result = dailySignalEdition(snapshot, '2026-09-09');
    expect(result.stocks).toEqual([]);
    expect(result.categoryStates?.stocks.status).toBe('empty');
  });

  it('preserves unavailable rather than presenting it as a quiet day', () => {
    const result = dailySignalEdition(
      {
        ...snapshot,
        categoryStates: {
          ...snapshot.categoryStates!,
          stocks: { status: 'unavailable', reason: 'd1_timeout' },
        },
      },
      '2026-09-09'
    );
    expect(result.categoryStates?.stocks).toEqual({ status: 'unavailable', reason: 'd1_timeout' });
  });
});
