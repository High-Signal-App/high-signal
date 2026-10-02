import { describe, expect, it, vi } from 'vitest';
import { generateChatCompletion, withWorkersAiBudget } from '../ai-client';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const CAP = 9_500;
const today = () => new Date().toISOString().slice(0, 10);

type ReplyOptions = {
  status?: number;
  allowed?: boolean;
  retryAfter?: number;
  dayKey?: string;
  used?: (reservation: number, accumulated: number) => number;
  body?: (reservation: number, used: number) => unknown;
};

function fakeBudget(options: ReplyOptions = {}) {
  let accumulated = 0;
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const reservation = Number((JSON.parse(String(init?.body)) as { neurons: number }).neurons);
    const allowed = options.allowed ?? true;
    const used =
      options.used?.(reservation, accumulated) ?? (allowed ? accumulated + reservation : CAP);
    if (allowed) accumulated = used;
    const body = options.body
      ? options.body(reservation, used)
      : {
          allowed,
          used,
          remaining: CAP - used,
          retryAfter: options.retryAfter ?? (allowed ? 0 : 120),
          dayKey: options.dayKey ?? today(),
        };
    return new Response(JSON.stringify(body), { status: options.status ?? 200 });
  });
  const namespace = {
    idFromName: vi.fn(() => 'global-budget'),
    get: vi.fn(() => ({ fetch })),
  } as unknown as DurableObjectNamespace;
  return { fetch, namespace };
}

describe('Workers AI daily budget guard', () => {
  it('routes managed chat completion through the private High Signal gateway binding', async () => {
    const tokenBudgets: number[] = [];
    const fetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
      expect(request.headers.get('x-gateway-project-id')).toBe('high-signal');
      expect(request.headers.get('authorization')).toBe('Bearer gateway-managed');
      const body = (await request.json()) as { model: string; max_tokens: number };
      expect(body.model).toBe('auto');
      tokenBudgets.push(body.max_tokens);
      return Response.json({ choices: [{ message: { content: 'managed summary' } }] });
    });
    const directRun = vi.fn();
    const config = {
      gateway: { fetch } as unknown as Fetcher,
      binding: { run: directRun } as unknown as Ai,
      model: 'auto',
    };

    await expect(
      generateChatCompletion({
        config,
        messages: [{ role: 'user', content: 'summarize evidence' }],
      })
    ).resolves.toBe('managed summary');
    await expect(
      generateChatCompletion({
        config,
        messages: [{ role: 'user', content: 'summarize more evidence' }],
        maxTokens: 9_000,
      })
    ).resolves.toBe('managed summary');
    expect(tokenBudgets).toEqual([512, 8_192]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(directRun).not.toHaveBeenCalled();
  });

  it('prices the bounded serialized UTF-8 payload and reserves every binding attempt', async () => {
    const budget = fakeBudget();
    const run = vi.fn(async (_model: string, _input: unknown) => ({ response: 'ok' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);
    const input = { messages: [{ role: 'user', content: '🌱'.repeat(1_000) }], max_tokens: 50_000 };
    const bounded = { ...input, max_tokens: 8_192 };

    await guarded.run(MODEL, input);
    const bytes = new TextEncoder().encode(JSON.stringify(bounded)).byteLength;
    const expectedNeurons = Math.ceil((bytes * 25_608 * 1.2 + 8_192 * 75_147) / 1_000_000);
    expect(JSON.parse(String(budget.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      neurons: expectedNeurons,
    });
    expect(run).toHaveBeenCalledWith(MODEL, bounded, undefined);

    const retryInput = { messages: [], max_tokens: 900 };
    await guarded.run(MODEL, retryInput);
    expect(budget.fetch).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(MODEL, retryInput, undefined);
    await guarded.run(MODEL, { messages: [] });
    expect(run).toHaveBeenLastCalledWith(MODEL, { messages: [], max_tokens: 512 }, undefined);
  });

  it('denies before inference when shared budget is exhausted', async () => {
    const budget = fakeBudget({ allowed: false });
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await expect(guarded.run(MODEL, { messages: [], max_tokens: 900 })).rejects.toMatchObject({
      code: 'neuron_budget_exhausted',
      used: CAP,
      remaining: 0,
      dayKey: today(),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong HTTP status', { status: 201 }],
    ['under-reserved usage', { used: (reservation: number) => reservation - 1 }],
    ['positive retry delay for an allowed reservation', { retryAfter: 1 }],
    ['stale day key', { dayKey: '2000-01-01' }],
    [
      'counter sum mismatch',
      {
        body: (_reservation: number, used: number) => ({
          allowed: true,
          used,
          remaining: CAP - used - 1,
          retryAfter: 0,
          dayKey: today(),
        }),
      },
    ],
    ['denied counter with no retry delay', { allowed: false, retryAfter: 0 }],
    ['array response', { body: () => [] }],
    ['null response', { body: () => null }],
  ])('fails closed on %s before inference', async (_label, options) => {
    const budget = fakeBudget(options);
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await expect(guarded.run(MODEL, { messages: [], max_tokens: 900 })).rejects.toMatchObject({
      code: 'neuron_budget_unavailable',
      used: null,
      remaining: null,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed on unpriced models and malformed input before debit or inference', async () => {
    const budget = fakeBudget();
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await expect(
      guarded.run('@cf/meta/llama-3.1-8b-instruct-fast', { messages: [], max_tokens: 900 })
    ).rejects.toMatchObject({ code: 'neuron_budget_model_unpriced' });
    await expect(guarded.run(MODEL, { messages: [], max_tokens: 0 })).rejects.toMatchObject({
      code: 'neuron_budget_input_invalid',
    });
    await expect(
      guarded.run(MODEL, [] as unknown as Record<string, unknown>)
    ).rejects.toMatchObject({
      code: 'neuron_budget_input_invalid',
    });
    expect(budget.fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects reservations larger than the whole UTC daily allowance', async () => {
    const budget = fakeBudget();
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, budget.namespace);

    await expect(
      guarded.run(MODEL, {
        messages: [{ role: 'user', content: 'x'.repeat(400_000) }],
        max_tokens: 900,
      })
    ).rejects.toMatchObject({ code: 'neuron_budget_request_too_large' });
    expect(budget.fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed without inventing usage when the budget binding is missing', async () => {
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guarded = withWorkersAiBudget({ run } as unknown as Ai, undefined);

    await expect(guarded.run(MODEL, { messages: [], max_tokens: 900 })).rejects.toMatchObject({
      code: 'neuron_budget_unavailable',
      used: null,
      remaining: null,
      dayKey: null,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
