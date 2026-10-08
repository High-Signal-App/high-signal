import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import worker from '../index';
import { sourceStatusCacheKey } from '../routes/data';

const fetcher = worker as unknown as {
  fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response>;
};

let d1: TestD1;
let stored: Map<string, unknown>;
let outer: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

beforeEach(() => {
  d1 = createSqliteD1();
  applyMigrations(d1);
  stored = new Map();
  outer = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('caches', { default: outer });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  d1.close();
});

function innerCache() {
  return {
    get: vi.fn(async (key: string) => stored.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      stored.set(key, JSON.parse(value));
    }),
  };
}

async function get(query: string, cache?: ReturnType<typeof innerCache>) {
  const pending: Promise<unknown>[] = [];
  const response = await fetcher.fetch(
    new Request(`https://api.highsignal.app/data/sources${query}`),
    { DB: d1.binding, ENVIRONMENT: 'test', ...(cache ? { BRIEF_CACHE: cache } : {}) },
    { waitUntil: (promise) => pending.push(promise) }
  );
  await Promise.all(pending);
  return response;
}

describe('private source-status KV diagnostics through the Worker cache boundary', () => {
  it('reports a real KV hit without touching D1 or either outer cache operation', async () => {
    const snapshot = { schemaVersion: '2', sources: [], total: 7, available: true };
    stored.set(sourceStatusCacheKey(2), snapshot);
    const cache = innerCache();
    const prepare = vi.spyOn(d1.binding, 'prepare');
    const response = await get('?timing=1&cache=observe&samples=2&marker=PRIVATE_SENTINEL', cache);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-source-cache')).toBe('HIT');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('server-timing')).toMatch(/^kv_read;dur=\d+\.\d+, route;dur=/);
    expect(response.headers.get('server-timing')).not.toContain('PRIVATE_SENTINEL');
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(cache.get).toHaveBeenCalledWith(sourceStatusCacheKey(2), 'json');
    expect(cache.put).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(outer.match).not.toHaveBeenCalled();
    expect(outer.put).not.toHaveBeenCalled();
  });

  it('reports MISS then HIT while storing only the ordinary payload at the existing TTL', async () => {
    const cache = innerCache();
    const first = await get('?timing=1&cache=observe', cache);
    const payload = await first.json();
    expect(first.headers.get('x-source-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(payload).toMatchObject({ available: true, schemaVersion: '2' });
    expect(cache.put).toHaveBeenCalledWith(sourceStatusCacheKey(0), JSON.stringify(payload), {
      expirationTtl: 6 * 60 * 60,
    });

    const second = await get('?timing=1&cache=observe', cache);
    expect(second.headers.get('x-source-cache')).toBe('HIT');
    await expect(second.json()).resolves.toEqual(payload);
    expect(cache.put).toHaveBeenCalledOnce();
    expect(outer.match).not.toHaveBeenCalled();
    expect(outer.put).not.toHaveBeenCalled();

    const ordinary = await get('', cache);
    expect(ordinary.headers.get('x-source-cache')).toBeNull();
    expect(ordinary.headers.get('server-timing')).toBeNull();
    expect(ordinary.headers.get('x-edge-cache')).toBe('API-MISS');
    await expect(ordinary.json()).resolves.toEqual(payload);
    const outerStored = outer.put.mock.calls[0][1] as Response;
    expect(outerStored.headers.get('x-source-cache')).toBeNull();
    expect(outerStored.headers.get('server-timing')).toBeNull();
    await expect(outerStored.json()).resolves.toEqual(payload);
  });

  it.each(['?timing=1', '?timing=1&cache=unknown'])(
    'preserves SQL-only diagnostics for %s',
    async (query) => {
      const cache = innerCache();
      stored.set(sourceStatusCacheKey(0), { unexpected: 'must not use KV' });
      const response = await get(query, cache);
      expect(response.headers.get('x-source-cache')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('server-timing')).toContain('source_rollup;dur=');
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.put).not.toHaveBeenCalled();
      expect(outer.put).not.toHaveBeenCalled();
    }
  );

  it('reports an absent binding as UNAVAILABLE, not a cache miss', async () => {
    const response = await get('?timing=1&cache=observe');
    expect(response.headers.get('x-source-cache')).toBe('UNAVAILABLE');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('server-timing')).not.toContain('kv_read');
    await expect(response.json()).resolves.toMatchObject({ available: true });
    expect(outer.match).not.toHaveBeenCalled();
    expect(outer.put).not.toHaveBeenCalled();
  });

  it('retains ERROR when a failed KV read falls back to the real source queries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = innerCache();
    cache.get.mockRejectedValueOnce(new Error('synthetic KV read failure'));
    const response = await get('?timing=1&cache=observe', cache);
    expect(response.headers.get('x-source-cache')).toBe('ERROR');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('server-timing')).toContain('kv_read;dur=');
    await expect(response.json()).resolves.toMatchObject({ available: true });
    expect(cache.put).toHaveBeenCalledOnce();
    expect(outer.match).not.toHaveBeenCalled();
    expect(outer.put).not.toHaveBeenCalled();
  });
});
