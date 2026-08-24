const PUBLIC_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const PRIVATE_CACHE_CONTROL = 'private, no-store';

type PublicApiCache = Pick<Cache, 'match' | 'put'>;

type PublicApiCacheOptions = {
  cache?: PublicApiCache | null;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function isPublicCacheRequest(request: Request) {
  if (request.method !== 'GET') return false;
  if (request.headers.has('authorization') || request.headers.has('cookie')) return false;

  const path = new URL(request.url).pathname;
  return path !== '/health' && path !== '/admin' && !path.startsWith('/admin/');
}

function cacheKey(request: Request) {
  return new Request(request.url, { method: 'GET' });
}

function withCacheStatus(response: Response, status: 'HIT' | 'MISS') {
  const headers = new Headers(response.headers);
  headers.set('x-edge-cache', `API-${status}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function privateResponse(response: Response) {
  const current = response.headers.get('cache-control')?.toLowerCase() ?? '';
  if (current.includes('private') || current.includes('no-store')) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Cache anonymous successful API reads in Cloudflare's data-center-local cache.
 * This avoids repeating D1 and upstream work while keeping admin, authenticated,
 * mutation, health, and error responses out of shared storage.
 */
export async function handlePublicApiCache(
  request: Request,
  next: () => Promise<Response>,
  options: PublicApiCacheOptions = {}
) {
  if (!isPublicCacheRequest(request) || !options.cache) {
    return privateResponse(await next());
  }

  const key = cacheKey(request);
  const cached = await options.cache.match(key);
  if (cached) return withCacheStatus(cached, 'HIT');

  const response = await next();
  if (response.status !== 200 || response.headers.has('set-cookie')) {
    return privateResponse(response);
  }

  const headers = new Headers(response.headers);
  const responsePolicy = headers.get('cache-control')?.toLowerCase() ?? '';
  if (responsePolicy.includes('private') || responsePolicy.includes('no-store')) {
    return response;
  }
  if (!headers.has('cache-control')) headers.set('Cache-Control', PUBLIC_CACHE_CONTROL);
  const cacheable = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const write = Promise.resolve(options.cache.put(key, cacheable.clone())).catch((error) => {
    console.error('[cache] public API write failed', error);
  });
  if (options.waitUntil) options.waitUntil(write);
  else await write;

  return withCacheStatus(cacheable, 'MISS');
}

export const publicApiCachePolicy = {
  public: PUBLIC_CACHE_CONTROL,
  private: PRIVATE_CACHE_CONTROL,
} as const;
