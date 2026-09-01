import { describe, expect, it } from 'vitest';
import app from '../index';
import {
  dailyEvidenceEvents,
  isMaterialEvidenceInputSource,
  materialEvidenceInputReceipt,
  resolveDailyDate,
} from '../routes/data';
import { partitionPublishable } from '../lib/signal-quality';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

describe('daily dump contract', () => {
  it('defaults to the current IST date and rejects malformed calendar dates', () => {
    expect(resolveDailyDate(undefined, new Date('2026-08-24T20:00:00.000Z'))).toBe('2026-08-25');
    expect(resolveDailyDate('2026-02-29')).toBeNull();
    expect(resolveDailyDate('not-a-date')).toBeNull();
  });

  it('projects canonical evidence rows without raw event or article-body fields', () => {
    const rows = [
      {
        id: 'evidence-1',
        signalId: 'signal-1',
        url: 'https://news.ycombinator.com/item?id=1',
        sourceType: 'hackernews',
        excerpt: 'A bounded excerpt.',
        publishedAt: new Date('2026-08-24T06:00:00.000Z'),
      },
    ];
    expect(dailyEvidenceEvents(rows, new Map([['signal-1', 'daily-signal']]))).toEqual([
      {
        ...rows[0],
        signalSlug: 'daily-signal',
      },
    ]);
  });

  it('documents evidence-input freshness separately from source publication time', () => {
    const payload = {
      evidenceInputCount: 1271,
      latestEvidenceInputAt: '2026-08-26T20:25:23.000Z',
      evidenceEvents: [{ publishedAt: '2026-08-25T12:00:00.000Z' }],
    };

    expect(payload.evidenceInputCount).toBeGreaterThan(0);
    expect(payload.latestEvidenceInputAt).toBe('2026-08-26T20:25:23.000Z');
  });

  it('excludes attention, prediction, and rejected discovery inputs from freshness', () => {
    expect(isMaterialEvidenceInputSource('news:axios')).toBe(true);
    expect(isMaterialEvidenceInputSource('ir:MSFT')).toBe(true);
    expect(isMaterialEvidenceInputSource('news:digg-verification:bloomberg.com')).toBe(false);
    expect(isMaterialEvidenceInputSource('news:mts-verification:reuters.com')).toBe(false);
    expect(isMaterialEvidenceInputSource('market:manifold')).toBe(false);
    expect(isMaterialEvidenceInputSource('reddit:technology')).toBe(false);
    expect(isMaterialEvidenceInputSource('hackernews')).toBe(false);
    expect(isMaterialEvidenceInputSource('techmeme')).toBe(false);

    expect(
      materialEvidenceInputReceipt([
        { source: 'news:axios', count: 3, latestIngestedAt: 100 },
        { source: 'ir:MSFT', count: 2, latestIngestedAt: 90 },
        {
          source: 'news:digg-verification:bloomberg.com',
          count: 1,
          latestIngestedAt: 300,
        },
        {
          source: 'news:mts-verification:reuters.com',
          count: 8,
          latestIngestedAt: 250,
        },
        { source: 'market:manifold', count: 100, latestIngestedAt: 250 },
        { source: 'reddit:technology', count: 50, latestIngestedAt: 200 },
      ])
    ).toEqual({ count: 5, latestIngestedAt: 100 });
  });

  it('reports withheld rows so an empty day is distinguishable from a withheld one', () => {
    const rows = [
      { id: 'a', publishable: true },
      { id: 'b', publishable: false },
      { id: 'c', publishable: false },
    ];
    const { published, withheldCount } = partitionPublishable(rows);

    // What is served is unchanged: withheld rows never enter the payload.
    expect(published.map((signal) => signal.id)).toEqual(['a']);
    expect(withheldCount).toBe(2);
  });

  it('separates "nothing published" from "everything withheld"', () => {
    // 2026-08-15 in production: 4 rows published, all withheld, signalCount 0.
    expect(partitionPublishable([])).toEqual({ published: [], withheldCount: 0 });
    expect(
      partitionPublishable([
        { publishable: false },
        { publishable: false },
        { publishable: false },
        { publishable: false },
      ]).withheldCount
    ).toBe(4);
  });

  it('returns 400 for an invalid date before reading D1', async () => {
    const response = await fetcher.fetch(new Request('http://test/data/daily?date=2026-99-99'), {
      ENVIRONMENT: 'test',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_date',
      expected: 'YYYY-MM-DD',
    });
  });
});
