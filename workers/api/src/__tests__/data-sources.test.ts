import { describe, expect, it, vi } from 'vitest';
import sourceCatalog from '../lib/source-catalog.json';
import { sourceRunStatus, sourceStatusCacheKey } from '../routes/data';
import app from '../index';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

describe('data source directory contract', () => {
  it('ships the complete generated catalog with explicit cadence', () => {
    expect(sourceCatalog.count).toBe(55);
    expect(sourceCatalog.sources).toHaveLength(55);
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'daily')).toHaveLength(28);
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'context')).toHaveLength(3);
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'weekly')).toHaveLength(7);
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'monthly')).toHaveLength(3);
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'on_demand')).toHaveLength(
      5
    );
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'manual')).toHaveLength(2);
    expect(sourceCatalog.sources.filter((source) => source.cadence === 'parked')).toHaveLength(7);
  });

  it('does not conflate empty, failed, manual, parked, and unknown runs', () => {
    const base = {
      source: 'hackernews',
      startedAt: new Date('2026-08-25T02:30:00.000Z'),
      finishedAt: new Date('2026-08-25T02:31:00.000Z'),
      errors: 0,
      eventsFetched: 0,
    };
    expect(sourceRunStatus('daily', undefined)).toBe('unknown');
    expect(sourceRunStatus('daily', base)).toBe('success_empty');
    expect(sourceRunStatus('daily', { ...base, eventsFetched: 3 })).toBe('success_with_data');
    expect(sourceRunStatus('daily', { ...base, errors: 1 })).toBe('failed');
    expect(sourceRunStatus('manual', undefined)).toBe('manual');
    expect(sourceRunStatus('on_demand', undefined)).toBe('on_demand');
    expect(sourceRunStatus('parked', undefined)).toBe('parked');
  });

  it('serves the shared source-status snapshot without touching D1', async () => {
    const snapshot = {
      schemaVersion: '2',
      generatedAt: '2026-08-30T00:00:00.000Z',
      sources: [],
      total: 0,
      available: true,
      samplesAvailable: true,
      uncataloguedSources: [],
    };
    const get = vi.fn(async (key: string) => (key === sourceStatusCacheKey(0) ? snapshot : null));
    const response = await fetcher.fetch(new Request('http://test/data/sources'), {
      ENVIRONMENT: 'test',
      BRIEF_CACHE: { get },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(get).toHaveBeenCalledWith(sourceStatusCacheKey(0), 'json');
  });

  it('rejects an impossible source-day before querying D1', async () => {
    const response = await fetcher.fetch(
      new Request('http://test/data/sources/hackernews?date=2026-02-30'),
      { ENVIRONMENT: 'test' }
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_date',
      expected: 'YYYY-MM-DD',
    });
  });
});
