import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signal: {
    id: 'signal-1',
    slug: 'reviewed-benchmark',
    primaryEntityId: 'OPENAI',
    reviewStatus: 'draft',
    bodyMd: 'A supported benchmark result.',
    publishedAt: new Date(),
    publishable: true,
  },
}));

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return {
    ...actual,
    db: () => ({
      select: () => ({
        from: () => ({
          where: () => Object.assign(Promise.resolve([]), { limit: async () => [state.signal] }),
        }),
      }),
    }),
  };
});
vi.mock('../lib/signal-quality', () => ({
  enrichPublishedSignals: async () => [],
  enrichSignal: (row: unknown) => row,
  enrichSignals: vi.fn(),
  partitionPublishable: vi.fn(),
}));

import { signalsRoute } from '../routes/signals';
import { handlePublicApiCache } from '../public-cache';

const app = new Hono();
app.route('/signals', signalsRoute);

describe('signal detail publication cache', () => {
  it('does not cache a draft that would hide its later published proof page', async () => {
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) };
    const request = new Request('https://api/signals/reviewed-benchmark');
    const next = async () => app.request(request, undefined, { DB: {} });
    const draft = await handlePublicApiCache(request, next, { cache });
    expect(draft.status).toBe(200);
    expect(draft.headers.get('cache-control')).toBe('private, no-store');
    expect(cache.put).not.toHaveBeenCalled();

    state.signal.reviewStatus = 'published';
    const published = await handlePublicApiCache(request, next, { cache });
    const body = (await published.json()) as { signal: { reviewStatus: string } };
    expect(body.signal.reviewStatus).toBe('published');
    expect(published.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
