import { describe, expect, it, vi } from 'vitest';
import { handlePublicApiCache, isPublicCacheRequest, publicApiCachePolicy } from '../public-cache';

function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    }),
  };
}

describe('public API edge cache', () => {
  it('routes only safe anonymous GETs into the front-of-Worker cache', () => {
    expect(isPublicCacheRequest(new Request('https://api.highsignal.app/brief/daily'))).toBe(true);
    expect(
      isPublicCacheRequest(
        new Request('https://api.highsignal.app/brief/daily', { method: 'HEAD' })
      )
    ).toBe(true);
    expect(
      isPublicCacheRequest(
        new Request('https://api.highsignal.app/brief/daily', { headers: { cookie: 'x=1' } })
      )
    ).toBe(false);
    expect(
      isPublicCacheRequest(
        new Request('https://api.highsignal.app/brief/daily', {
          headers: { 'cache-control': 'no-cache' },
        })
      )
    ).toBe(false);
    expect(
      isPublicCacheRequest(
        new Request('https://api.highsignal.app/brief/daily', {
          headers: { authorization: 'Bearer redacted' },
        })
      )
    ).toBe(false);
    expect(isPublicCacheRequest(new Request('https://api.highsignal.app/admin/audit'))).toBe(false);
    expect(isPublicCacheRequest(new Request('https://api.highsignal.app/health'))).toBe(false);
    expect(
      isPublicCacheRequest(new Request('https://api.highsignal.app/signals', { method: 'POST' }))
    ).toBe(false);
  });

  it('bypasses shared caching only for explicit diagnostics on measured routes', () => {
    expect(
      isPublicCacheRequest(new Request('https://api.highsignal.app/brief/daily?timing=1'))
    ).toBe(false);
    expect(
      isPublicCacheRequest(new Request('https://api.highsignal.app/data/sources?timing=1'))
    ).toBe(false);
    expect(
      isPublicCacheRequest(new Request('https://api.highsignal.app/data/sources/markets?timing=1'))
    ).toBe(false);
    expect(
      isPublicCacheRequest(new Request('https://api.highsignal.app/data/sources/markets'))
    ).toBe(true);
    expect(
      isPublicCacheRequest(
        new Request('https://api.highsignal.app/brief/daily?verification=not-diagnostics')
      )
    ).toBe(true);
    expect(isPublicCacheRequest(new Request('https://api.highsignal.app/signals?timing=1'))).toBe(
      true
    );
  });

  it('does not store diagnostic timing responses in the shared API cache', async () => {
    const cache = memoryCache();
    const response = await handlePublicApiCache(
      new Request('https://api.highsignal.app/brief/daily?timing=1'),
      async () =>
        Response.json(
          { ok: true },
          {
            headers: {
              'cache-control': 'private, no-store',
              'server-timing': 'snapshot;dur=12.3',
            },
          }
        ),
      { cache }
    );

    expect(response.headers.get('server-timing')).toBe('snapshot;dur=12.3');
    expect(response.headers.get('x-edge-cache')).toBeNull();
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('makes a safe HEAD response front-cacheable without storing it as a GET body', async () => {
    const cache = memoryCache();
    const response = await handlePublicApiCache(
      new Request('https://api.highsignal.app/data/sources', { method: 'HEAD' }),
      async () => Response.json({ shouldNotLeakIntoBody: true }),
      { cache }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(publicApiCachePolicy.public);
    await expect(response.text()).resolves.toBe('');
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('serves a repeated anonymous GET without calling the route again', async () => {
    const cache = memoryCache();
    const next = vi.fn(async () =>
      Response.json(
        { generatedAt: '2026-08-24T00:00:00Z' },
        { headers: { 'server-timing': 'snapshot;dur=12.3' } }
      )
    );
    const request = new Request('https://api.highsignal.app/brief/daily?region=global');

    const miss = await handlePublicApiCache(request, next, { cache });
    const hit = await handlePublicApiCache(request, next, { cache });

    expect(miss.headers.get('x-edge-cache')).toBe('API-MISS');
    expect(miss.headers.get('server-timing')).toBe('snapshot;dur=12.3');
    expect(hit.headers.get('x-edge-cache')).toBe('API-HIT');
    expect(hit.headers.get('server-timing')).toBeNull();
    expect(hit.headers.get('cache-control')).toBe(publicApiCachePolicy.public);
    await expect(hit.json()).resolves.toEqual({ generatedAt: '2026-08-24T00:00:00Z' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('bypasses a legacy retained-record receipt and then reuses the corrected cache entry', async () => {
    const cache = memoryCache();
    const url = 'https://api.highsignal.app/data/records/ffa11de3b61c32a4?view=full';
    const request = new Request(url, { headers: { 'x-request-context': 'preserved' } });
    await cache.put(request, Response.json({ retainedText: 'old shared report body' }));
    cache.put.mockClear();
    const next = vi.fn(async () => {
      expect(request.url).toBe(url);
      expect(request.headers.get('x-request-context')).toBe('preserved');
      return Response.json({ retainedText: 'correct per-contract report body' });
    });

    const miss = await handlePublicApiCache(request, next, { cache });
    const hit = await handlePublicApiCache(request, next, { cache });

    expect(miss.headers.get('x-edge-cache')).toBe('API-MISS');
    expect(hit.headers.get('x-edge-cache')).toBe('API-HIT');
    await expect(miss.json()).resolves.toEqual({
      retainedText: 'correct per-contract report body',
    });
    await expect(hit.json()).resolves.toEqual({ retainedText: 'correct per-contract report body' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const cacheUrl = new URL(cache.match.mock.calls[0]![0].url);
    expect(cacheUrl.pathname).toBe('/data/records/ffa11de3b61c32a4');
    expect(cacheUrl.searchParams.get('view')).toBe('full');
    expect(cacheUrl.searchParams.get('__hs_retained_record_cache')).toBe('retained-record-v2');
    await expect((await cache.match(request))!.json()).resolves.toEqual({
      retainedText: 'old shared report body',
    });
  });

  it('overrides a caller-supplied retained-record namespace without changing the origin request', async () => {
    const cache = memoryCache();
    const request = new Request(
      'https://api.highsignal.app/data/records/ev-1?__hs_retained_record_cache=legacy&__hs_retained_record_cache=other'
    );
    const next = vi.fn(async () => {
      expect(new URL(request.url).searchParams.getAll('__hs_retained_record_cache')).toEqual([
        'legacy',
        'other',
      ]);
      return Response.json({ available: true });
    });
    await handlePublicApiCache(request, next, { cache });
    const key = new URL(cache.match.mock.calls[0]![0].url);
    expect(key.searchParams.getAll('__hs_retained_record_cache')).toEqual(['retained-record-v2']);
    await handlePublicApiCache(new Request('https://api.highsignal.app/data/records/ev-1'), next, {
      cache,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each(['/data/records', '/data/records/ev-1/extra', '/data/sources', '/brief/daily'])(
    'leaves the cache key unchanged for %s',
    async (path) => {
      const cache = memoryCache();
      const request = new Request(
        `https://api.highsignal.app${path}?view=full&__hs_retained_record_cache=caller`
      );
      await handlePublicApiCache(request, async () => Response.json({ ok: true }), { cache });
      expect(cache.match.mock.calls[0]![0].url).toBe(request.url);
    }
  );

  it.each([
    ['authorization', { authorization: 'Bearer redacted' }],
    ['cookie', { cookie: 'x=1' }],
    ['no-cache', { 'cache-control': 'no-cache' }],
    ['no-store', { 'cache-control': 'no-store' }],
  ])('keeps retained-record %s requests out of shared cache', async (_name, headers) => {
    const cache = memoryCache();
    const response = await handlePublicApiCache(
      new Request('https://api.highsignal.app/data/records/ev-1', { headers }),
      async () => Response.json({ retainedText: 'fresh body' }),
      { cache }
    );
    expect(response.headers.get('cache-control')).toBe(publicApiCachePolicy.private);
    expect(response.headers.get('x-edge-cache')).toBeNull();
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('keeps query variants in separate cache entries', async () => {
    const cache = memoryCache();
    const next = vi.fn(async () => Response.json({ ok: true }));

    await handlePublicApiCache(
      new Request('https://api.highsignal.app/data/daily?date=2026-08-23'),
      next,
      { cache }
    );
    await handlePublicApiCache(
      new Request('https://api.highsignal.app/data/daily?date=2026-08-24'),
      next,
      { cache }
    );

    expect(next).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['admin', new Request('https://api.highsignal.app/admin/audit/summary')],
    ['health', new Request('https://api.highsignal.app/health')],
    [
      'authorized',
      new Request('https://api.highsignal.app/signals', {
        headers: { authorization: 'Bearer redacted' },
      }),
    ],
    ['cookie', new Request('https://api.highsignal.app/signals', { headers: { cookie: 'x=1' } })],
    ['mutation', new Request('https://api.highsignal.app/signals', { method: 'POST' })],
  ])('does not share-cache a %s request', async (_name, request) => {
    const cache = memoryCache();
    const next = vi.fn(async () => Response.json({ ok: true }));

    const response = await handlePublicApiCache(request, next, { cache });

    expect(response.headers.get('cache-control')).toBe(publicApiCachePolicy.private);
    expect(response.headers.get('x-edge-cache')).toBeNull();
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('does not store errors or responses that set cookies', async () => {
    const cache = memoryCache();
    const notFound = await handlePublicApiCache(
      new Request('https://api.highsignal.app/missing'),
      async () =>
        Response.json(
          { error: 'missing' },
          { status: 404, headers: { 'cache-control': 'public, max-age=300' } }
        ),
      { cache }
    );
    const personalized = await handlePublicApiCache(
      new Request('https://api.highsignal.app/signals'),
      async () => Response.json({ ok: true }, { headers: { 'set-cookie': 'session=private' } }),
      { cache }
    );

    expect(notFound.headers.get('cache-control')).toBe(publicApiCachePolicy.private);
    expect(personalized.headers.get('cache-control')).toBe(publicApiCachePolicy.private);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('honors an explicit private policy on a successful public route', async () => {
    const cache = memoryCache();
    const response = await handlePublicApiCache(
      new Request('https://api.highsignal.app/signals'),
      async () => Response.json({ ok: true }, { headers: { 'cache-control': 'private' } }),
      { cache }
    );

    expect(response.headers.get('cache-control')).toBe('private');
    expect(response.headers.get('x-edge-cache')).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('preserves a route-specific public shared-cache TTL', async () => {
    const cache = memoryCache();
    const response = await handlePublicApiCache(
      new Request('https://api.highsignal.app/data/sources'),
      async () =>
        Response.json(
          { sources: [] },
          { headers: { 'cache-control': 'public, max-age=60, s-maxage=3600' } }
        ),
      { cache }
    );

    expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=3600');
    expect(response.headers.get('x-edge-cache')).toBe('API-MISS');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
