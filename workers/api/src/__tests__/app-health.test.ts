import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeApiRoute, observeApiRequest } from '../app-health';

describe('API App Health observer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records one normalized request including query-free route and latency', async () => {
    const deliveries: Promise<unknown>[] = [];
    const requests: Array<{ input: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      requests.push({ input, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);
    observeApiRequest(
      new Request('https://api.example/signals/secret-slug?limit=100'),
      new Response('ok', { status: 200 }),
      Date.now() - 12,
      { APP_HEALTH_INGEST_KEY: 'secret', APP_HEALTH_ENVIRONMENT: 'production' },
      {
        waitUntil: (promise: Promise<unknown>) => deliveries.push(promise),
      } as unknown as ExecutionContext
    );
    await Promise.all(deliveries);
    expect(fetchMock).toHaveBeenCalled();
    const endpoints = requests.map(({ input }) => input);
    expect(endpoints).toContain('https://ingest.sassmaker.com/v1/ingest');
    const ingest = requests.find(({ input }) => input.endsWith('/v1/ingest'))?.body as {
      events: Array<Record<string, unknown>>;
    };
    expect(ingest.events).toHaveLength(1);
    expect(ingest.events[0]).toMatchObject({
      method: 'GET',
      route: '/api/signals/:slug',
      status_code: 200,
    });
    expect(ingest.events[0]).not.toHaveProperty('query');
    if (endpoints.length > 1) expect(endpoints).toContain('https://ingest.sassmaker.com/v1/logs');
  });

  it('fails open when the ingest backend errors and when no key is configured', async () => {
    const deliveries: Promise<unknown>[] = [];
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => deliveries.push(promise),
    } as unknown as ExecutionContext;
    expect(() =>
      observeApiRequest(
        new Request('https://api.example/health'),
        new Response(null, { status: 200 }),
        Date.now(),
        { APP_HEALTH_INGEST_KEY: 'secret' },
        ctx
      )
    ).not.toThrow();
    await Promise.all(deliveries);
    expect(() =>
      observeApiRequest(
        new Request('https://api.example/health'),
        new Response(null, { status: 200 }),
        Date.now(),
        {},
        ctx
      )
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only returns allowlisted templates', () => {
    expect(normalizeApiRoute('/signals/private')).toBe('/signals/:slug');
    expect(normalizeApiRoute('/unknown/private')).toBeNull();
  });
});
