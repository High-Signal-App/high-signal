import { describe, expect, it, vi } from 'vitest';
import { withWorkersAiBudget } from '../ai-client';

function fakeBudget(allowed: boolean) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return Response.json({
      allowed,
      used: allowed ? 25 : 9_500,
      remaining: allowed ? 9_475 : 0,
      retryAfter: allowed ? 0 : 100,
      dayKey: '2026-10-02',
    });
  });
  const namespace = {
    idFromName: vi.fn(() => 'global-budget'),
    get: vi.fn(() => ({ fetch })),
  } as unknown as DurableObjectNamespace;
  return { fetch, namespace };
}

describe('Workers AI daily budget guard', () => {
  it('reserves each binding attempt and caps the actual output request', async () => {
    const budget = fakeBudget(true);
    const run = vi.fn(async (_model: string, _input: unknown) => ({ response: 'ok' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await guarded.run('@cf/meta/llama-3.1-8b-instruct', { messages: [], max_tokens: 50_000 });
    const input = {
      messages: [{ role: 'user', content: '🌱'.repeat(1_000) }],
      max_tokens: 900,
    };
    await guarded.run('@cf/meta/llama-3.1-8b-instruct', input);

    expect(budget.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(budget.fetch.mock.calls[0]?.[1]?.body)).neurons).toBeGreaterThan(0);
    expect(run).toHaveBeenNthCalledWith(
      1,
      '@cf/meta/llama-3.1-8b-instruct',
      { messages: [], max_tokens: 8_192 },
      undefined
    );
    expect(run).toHaveBeenNthCalledWith(2, '@cf/meta/llama-3.1-8b-instruct', input, undefined);
    expect(JSON.parse(String(budget.fetch.mock.calls[1]?.[1]?.body)).neurons).toBe(113);
  });

  it('denies before inference when shared budget is exhausted', async () => {
    const budget = fakeBudget(false);
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await expect(
      guarded.run('@cf/meta/llama-3.1-8b-instruct', { messages: [], max_tokens: 900 })
    ).rejects.toMatchObject({
      code: 'neuron_budget_exhausted',
      used: 9_500,
      remaining: 0,
      retryAfter: 100,
      dayKey: '2026-10-02',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed on an unpriced legacy model before debit or inference', async () => {
    const budget = fakeBudget(true);
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await expect(
      guarded.run('@cf/meta/llama-3.1-8b-instruct-fast', { messages: [], max_tokens: 900 })
    ).rejects.toMatchObject({ code: 'neuron_budget_model_unpriced' });
    expect(budget.fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed without inventing usage when the budget binding is missing', async () => {
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, undefined);

    await expect(
      guarded.run('@cf/meta/llama-3.1-8b-instruct', { messages: [], max_tokens: 900 })
    ).rejects.toMatchObject({
      code: 'neuron_budget_unavailable',
      used: null,
      remaining: null,
      dayKey: null,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
