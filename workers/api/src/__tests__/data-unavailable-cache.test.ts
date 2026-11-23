import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { app } from '../app';
import { handlePublicApiCache, publicApiCachePolicy } from '../public-cache';

const NOW = Math.floor(Date.now() / 1000);

let d1: TestD1;

beforeEach(() => {
  d1 = createSqliteD1();
  applyMigrations(d1);
  d1.exec(
    `INSERT INTO events (id, source, source_url, published_at, title, raw_hash, ingested_at)
     VALUES ('ev-1', 'news:example', 'https://example.test/story', ${NOW}, 'Example story', 'h-1', ${NOW})`
  );
});

afterEach(() => d1.close());

function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    }),
  };
}

function failOneRead(binding: D1Database, table: string): D1Database {
  let shouldFail = true;
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') {
          return (...values: unknown[]) => wrap(target.bind(...values), sql);
        }
        if (property === 'all' || property === 'first' || property === 'raw') {
          return (...args: unknown[]) => {
            if (shouldFail && new RegExp(`\\b${table}\\b`, 'i').test(sql)) {
              shouldFail = false;
              throw new Error('injected transient D1 read failure');
            }
            const method = Reflect.get(target, property, target) as (
              ...values: unknown[]
            ) => unknown;
            return method.apply(target, args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return new Proxy(binding, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => wrap(target.prepare(sql), sql);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function cachedGet(path: string, DB: D1Database, cache: ReturnType<typeof memoryCache>) {
  const request = new Request(`https://api.highsignal.app${path}`);
  return handlePublicApiCache(
    request,
    () => Promise.resolve(app.fetch(request, { DB, ENVIRONMENT: 'test' })),
    {
      cache,
    }
  );
}

describe('unavailable data responses and the public API cache', () => {
  it.each([
    ['/data/sources', 'events', 'public, max-age=60, s-maxage=3600'],
    ['/data/sources/news', 'events', 'public, max-age=60, s-maxage=300'],
    ['/data/sources/digg', 'digg_clusters', 'public, max-age=60, s-maxage=300'],
    ['/data/records/ev-1', 'events', 'public, max-age=60, s-maxage=300'],
  ])('does not cache a transient read failure for %s', async (path, table, cacheControl) => {
    const cache = memoryCache();
    const DB = failOneRead(d1.binding, table);

    const failed = await cachedGet(path, DB, cache);
    expect(failed.status).toBe(200);
    expect(failed.headers.get('cache-control')).toBe(publicApiCachePolicy.private);
    expect(failed.headers.get('x-edge-cache')).toBeNull();
    expect(await failed.json()).toMatchObject({ available: false });
    expect(cache.put).not.toHaveBeenCalled();

    const recovered = await cachedGet(path, d1.binding, cache);
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('cache-control')).toBe(cacheControl);
    expect(recovered.headers.get('x-edge-cache')).toBe('API-MISS');
    expect(await recovered.json()).toMatchObject({ available: true });

    const hit = await cachedGet(path, d1.binding, cache);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('x-edge-cache')).toBe('API-HIT');
    expect(await hit.json()).toMatchObject({ available: true });
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown record ids as uncached 404s', async () => {
    const cache = memoryCache();
    const first = await cachedGet('/data/records/missing', d1.binding, cache);
    const second = await cachedGet('/data/records/missing', d1.binding, cache);

    expect(first.status).toBe(404);
    expect(first.headers.get('cache-control')).toBe(publicApiCachePolicy.private);
    expect(second.status).toBe(404);
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.match).toHaveBeenCalledTimes(2);
  });
});
