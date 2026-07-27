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

  it('/products/dashboard validates owner boundary', async () => {
    const res = await fetcher.fetch(new Request('http://t/products/dashboard'), testEnv);
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBe('missing_owner');
  });
});
