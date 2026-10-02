import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';

export interface AIConfig {
  binding?: Ai;
  gateway?: Fetcher;
  neuronBudget?: DurableObjectNamespace;
  endpointUrl?: string;
  apiKey?: string;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionOptions {
  config: AIConfig;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Generate text through an explicitly configured free-provider/local endpoint. */
export async function generateChatCompletion(options: ChatCompletionOptions): Promise<string> {
  const { config, messages, systemPrompt, maxTokens = 512, signal } = options;
  const model = config.gateway
    ? createOpenAICompatible({
        name: 'fleet-managed-gateway',
        baseURL: 'https://fleet-gateway.internal/v1',
        apiKey: 'gateway-managed',
        supportsStructuredOutputs: false,
        fetch: (input, init) => {
          const request = new Request(input, init);
          const headers = new Headers(request.headers);
          headers.set('x-gateway-project-id', 'high-signal');
          return config.gateway!.fetch(new Request(request, { headers }));
        },
      }).chatModel('auto')
    : config.binding
      ? createWorkersAI({ binding: withWorkersAiBudget(config.binding, config.neuronBudget) })(
          config.model
        )
      : createOpenAICompatible({
          name: 'high-signal-direct',
          baseURL: required(config.endpointUrl, 'AI endpoint URL').trim().replace(/\/+$/, ''),
          apiKey: required(config.apiKey, 'AI API key'),
        }).chatModel(config.model);
  const result = await generateText({
    model,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages,
    maxOutputTokens: Math.min(maxTokens, MAX_OUTPUT_TOKENS),
    maxRetries: 0,
    abortSignal: signal,
  });
  return result.text;
}

const BUDGET_CAP = 9_500;
const DEFAULT_OUTPUT_TOKENS = 512;
const MAX_OUTPUT_TOKENS = 8_192;
const NEURON_BUFFER = 1.2;
const BUDGET_ORIGIN = 'https://internal.local';
const TEXT_PRICING: Record<string, { input: number; output: number }> = {
  '@cf/meta/llama-3.1-8b-instruct': { input: 25_608, output: 75_147 },
};

export function withWorkersAiBudget(binding: Ai, budget: DurableObjectNamespace | undefined): Ai {
  return new Proxy(binding, {
    get(target, property) {
      if (property !== 'run') return Reflect.get(target, property, target);
      return async (model: string, input: unknown, options?: AiOptions) => {
        const plan = planRequest(model, input);
        if ('error' in plan) throw budgetError(plan.error);
        const debit = await reserveNeurons(budget, plan.neurons);
        if (!debit) throw budgetError('neuron_budget_unavailable');
        if (!debit.allowed) throw budgetError('neuron_budget_exhausted', debit);
        return target.run.call(target, model, plan.input, options);
      };
    },
  });
}

type DebitResult = {
  allowed: boolean;
  used: number;
  remaining: number;
  retryAfter: number;
  dayKey: string;
};

type NormalizedInput = Record<string, unknown> & { max_tokens: number };
type RequestPlan = { input: NormalizedInput; neurons: number } | { error: string };

function planRequest(model: string, value: unknown): RequestPlan {
  const pricing = TEXT_PRICING[model];
  if (!pricing) return { error: 'neuron_budget_model_unpriced' };
  const input = normalizeInput(value);
  if (!input) return { error: 'neuron_budget_input_invalid' };
  const serialized = serializeInput(input);
  if (!serialized) return { error: 'neuron_budget_input_invalid' };

  const inputBytes = new TextEncoder().encode(serialized).byteLength;
  const neurons = Math.max(
    1,
    Math.ceil(
      (inputBytes * pricing.input * NEURON_BUFFER + input.max_tokens * pricing.output) / 1_000_000
    )
  );
  return neurons > BUDGET_CAP ? { error: 'neuron_budget_request_too_large' } : { input, neurons };
}

function normalizeInput(value: unknown): NormalizedInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const requested = 'max_tokens' in source ? source['max_tokens'] : DEFAULT_OUTPUT_TOKENS;
  if (!isPositiveSafeInteger(requested)) return null;
  const outputTokens = Math.min(requested, MAX_OUTPUT_TOKENS);
  return { ...source, max_tokens: outputTokens };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function serializeInput(input: NormalizedInput): string | null {
  try {
    return JSON.stringify(input) ?? null;
  } catch {
    return null;
  }
}

async function reserveNeurons(
  budget: DurableObjectNamespace | undefined,
  neurons: number
): Promise<DebitResult | null> {
  if (!budget) return null;
  try {
    const id = budget.idFromName('global-budget');
    const response = await budget.get(id).fetch(`${BUDGET_ORIGIN}/try-debit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ neurons }),
    });
    const body: unknown = await response.json().catch(() => null);
    return isDebit(body, response.status, neurons) ? body : null;
  } catch {
    return null;
  }
}

function isDebit(value: unknown, status: number, neurons: number): value is DebitResult {
  if (!isDebitSnapshot(value, status)) return false;
  const result = value;
  return result.allowed
    ? result.retryAfter === 0 && result.used >= neurons
    : result.retryAfter > 0 && result.used + neurons > BUDGET_CAP;
}

function isDebitSnapshot(value: unknown, status: number): value is DebitResult {
  if (status !== 200 || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return isDebitFields(value as Record<string, unknown>);
}

function isDebitFields(result: Record<string, unknown>): result is DebitResult {
  const used = result['used'];
  const remaining = result['remaining'];
  const retryAfter = result['retryAfter'];
  if (typeof result['allowed'] !== 'boolean' || !isCounter(used) || !isCounter(remaining)) {
    return false;
  }
  if (used + remaining !== BUDGET_CAP || !isCounter(retryAfter, Number.MAX_SAFE_INTEGER)) {
    return false;
  }
  return result['dayKey'] === new Date().toISOString().slice(0, 10);
}

function isCounter(value: unknown, maximum = BUDGET_CAP): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function budgetError(code: string, debit: DebitResult | null = null) {
  return Object.assign(
    new Error(
      debit === null
        ? 'Workers AI daily budget state is unavailable.'
        : `Workers AI daily budget exhausted (${debit.used}/${BUDGET_CAP}).`
    ),
    {
      code,
      used: debit?.used ?? null,
      remaining: debit?.remaining ?? null,
      retryAfter: debit?.retryAfter ?? null,
      dayKey: debit?.dayKey ?? null,
    }
  );
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}
