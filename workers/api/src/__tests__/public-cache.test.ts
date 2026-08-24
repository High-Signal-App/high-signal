import { describe, expect, it, vi } from 'vitest';
import { handlePublicApiCache, publicApiCachePolicy } from '../public-cache';

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
  it('serves a repeated anonymous GET without calling the route again', async () => {
    const cache = memoryCache();
    const next = vi.fn(async () => Response.json({ generatedAt: '2026-08-24T00:00:00Z' }));
    const request = new Request('https://api.highsignal.app/brief/daily?region=global');

    const miss = await handlePublicApiCache(request, next, { cache });
    const hit = await handlePublicApiCache(request, next, { cache });

    expect(miss.headers.get('x-edge-cache')).toBe('API-MISS');
    expect(hit.headers.get('x-edge-cache')).toBe('API-HIT');
    expect(hit.headers.get('cache-control')).toBe(publicApiCachePolicy.public);
    await expect(hit.json()).resolves.toEqual({ generatedAt: '2026-08-24T00:00:00Z' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
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
});
