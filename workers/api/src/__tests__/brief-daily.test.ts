import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tryGetPrecomputedSnapshot: vi.fn(),
  buildStocks: vi.fn(async () => []),
  buildIdeas: vi.fn(async () => []),
  buildTrends: vi.fn(async () => []),
  buildDiggAttention: vi.fn(async () => ({
    attentionLeaders: [],
    emergingBeforeMainstream: [],
    attentionEvidenceGaps: [],
  })),
  buildPerception: vi.fn(async () => []),
  buildImprovements: vi.fn(async () => []),
  buildWatching: vi.fn(async () => []),
  buildIntentBriefItems: vi.fn(async () => []),
}));

vi.mock('../../db', () => ({
  db: () => ({ mocked: true }),
  schema: {},
}));

vi.mock('../routes/brief/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/brief/query')>();
  return {
    ...actual,
    tryGetPrecomputedSnapshot: mocks.tryGetPrecomputedSnapshot,
    buildStocks: mocks.buildStocks,
    buildIdeas: mocks.buildIdeas,
    buildTrends: mocks.buildTrends,
    buildDiggAttention: mocks.buildDiggAttention,
    buildPerception: mocks.buildPerception,
    buildImprovements: mocks.buildImprovements,
    buildWatching: mocks.buildWatching,
    buildIntentBriefItems: mocks.buildIntentBriefItems,
  };
});

import { briefRoute, parseDailyBriefRequest, safeCategory } from '../routes/brief';
import { dailySignalEdition } from '../routes/brief/route';
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
      productId: '',
      archiveDate: null,
    });
  });

  it('keeps a valid archive date and unknown regions fall back to global', async () => {
    const response = await app.request(
      'http://test/?region=not-a-region&date=2026-01-02&product=acme'
    );
    await expect(response.json()).resolves.toEqual({
      region: 'global',
      productId: 'acme',
      archiveDate: '2026-01-02',
    });
  });

  // There is no per-user brief variant any more, so `owner` must not survive
  // into the request shape — if it did it would fragment the edge cache.
  it('ignores a legacy owner parameter', async () => {
    const response = await app.request('http://test/?owner=user-1');
    await expect(response.json()).resolves.toEqual({
      region: 'global',
      productId: '',
      archiveDate: null,
    });
  });
});

describe('GET /daily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tryGetPrecomputedSnapshot.mockResolvedValue(null);
    mocks.buildStocks.mockResolvedValue([]);
    mocks.buildIdeas.mockResolvedValue([]);
    mocks.buildTrends.mockResolvedValue([]);
    mocks.buildDiggAttention.mockResolvedValue({
      attentionLeaders: [],
      emergingBeforeMainstream: [],
      attentionEvidenceGaps: [],
    });
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
    const stock = { ticker: 'NVDA', publishedAt: new Date().toISOString() };
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
      hasBrand: boolean;
      stocks: unknown[];
      ideas: unknown[];
      attentionLeaders: unknown[];
      emergingBeforeMainstream: unknown[];
      attentionEvidenceGaps: unknown[];
      categoryStates: Record<string, { status: string; reason: string | null }>;
    };
    expect(body.region).toBe('north-america');
    expect(body.hasBrand).toBe(false);
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

  it('marks a live-composed brief as pending with nextExpectedPublishAt', async () => {
    const stock = { ticker: 'NVDA', publishedAt: new Date().toISOString() };
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
      hasBrand: false,
      stocks: [],
      ideas: [],
      trends: [],
      perception: [],
      improvements: [],
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
      hasBrand: false,
      stocks: [{ signalSlug: 'stale', publishedAt: `${day}T03:00:00Z` }],
      ideas: [],
      trends: [],
      perception: [],
      improvements: [],
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
      hasBrand: false,
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
      perception: [],
      improvements: [],
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
    hasBrand: false,
    stocks: [
      { signalSlug: 'old', publishedAt: '2026-09-06T18:29:59Z' },
      { signalSlug: 'start', publishedAt: '2026-09-06T18:30:00Z' },
      { signalSlug: 'end', publishedAt: '2026-09-07T18:29:59Z' },
      { signalSlug: 'tomorrow', publishedAt: '2026-09-07T18:30:00Z' },
      { signalSlug: 'undated' },
    ],
    ideas: [],
    trends: [],
    perception: [],
    improvements: [],
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
