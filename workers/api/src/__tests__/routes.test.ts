import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../index';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};
const originalFetch = globalThis.fetch;
const testEnv = { ENVIRONMENT: 'test' };

describe('worker routes', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('/health returns ok', async () => {
    const res = await fetcher.fetch(new Request('http://t/health'), testEnv);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });

  it('/ returns metadata', async () => {
    const res = await fetcher.fetch(new Request('http://t/'), testEnv);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { name: string };
    expect(j.name).toBe('high-signal-api');
  });

  it('/communities/reddit/:subreddit returns normalized subreddit metadata', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        data: {
          display_name: 'LocalLLaMA',
          title: 'Local LLMs',
          public_description: 'Open model discussion',
          subscribers: 1234,
          active_user_count: 56,
          created_utc: 1700000000,
          over18: false,
        },
      })
    ) as typeof fetch;

    const res = await fetcher.fetch(new Request('http://t/communities/reddit/LocalLLaMA'), testEnv);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { community: { name: string; subscribers: number } };
    expect(j.community.name).toBe('LocalLLaMA');
    expect(j.community.subscribers).toBe(1234);
  });

  // The per-owner product dashboard was removed with the rest of the per-user
  // surface; the tracked-community registry it exposed now lives behind
  // ADMIN_TOKEN on /admin/communities/tracked.
  it('/products/dashboard is gone', async () => {
    const res = await fetcher.fetch(new Request('http://t/products/dashboard'), testEnv);
    expect(res.status).toBe(404);
  });

  it('/admin/communities/tracked refuses an unauthenticated caller', async () => {
    const res = await fetcher.fetch(new Request('http://t/admin/communities/tracked'), testEnv);
    expect([401, 503]).toContain(res.status);
  });

  it('allows cross-origin preflights only for public routes', async () => {
    const publicResponse = await fetcher.fetch(
      new Request('http://t/signals', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://reader.example',
          'Access-Control-Request-Method': 'GET',
        },
      }),
      testEnv
    );
    expect(publicResponse.status).toBe(204);
    expect(publicResponse.headers.get('access-control-allow-origin')).toBe('*');

    const adminResponse = await fetcher.fetch(
      new Request('http://t/admin/signals/example', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://attacker.example',
          'Access-Control-Request-Method': 'PATCH',
        },
      }),
      testEnv
    );
    expect(adminResponse.status).toBe(403);
    expect(adminResponse.headers.get('access-control-allow-origin')).toBeNull();
  });
});
