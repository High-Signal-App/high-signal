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
    mocks.buildStocks.mockResolvedValue([{ ticker: 'NVDA' }] as never);
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
    expect(body.stocks).toEqual([{ ticker: 'NVDA' }]);
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
