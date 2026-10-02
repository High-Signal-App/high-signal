import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';

export interface AIConfig {
  binding?: Ai;
  neuronBudget?: DurableObjectNamespace;
  endpointUrl?: string;
  apiKey?: string;
  model: string;
}

export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

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
  const model = config.binding
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
    maxOutputTokens: maxTokens,
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
        const pricing = TEXT_PRICING[model];
        if (!pricing || !input || typeof input !== 'object') {
          throw budgetError('neuron_budget_model_unpriced', null, null, null, null);
        }

        const rawOutput = Number(
          (input as { max_tokens?: unknown }).max_tokens ?? DEFAULT_OUTPUT_TOKENS
        );
        if (!Number.isFinite(rawOutput) || rawOutput < 0) {
          throw budgetError('neuron_budget_input_invalid', null, null, null, null);
        }
        const outputTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.ceil(rawOutput)));
        const boundedInput = {
          ...(input as Record<string, unknown>),
          max_tokens: outputTokens,
        };
        let serialized: string;
        try {
          serialized = JSON.stringify(boundedInput);
        } catch {
          throw budgetError('neuron_budget_input_unserializable', null, null, null, null);
        }
        const inputTokens = Math.max(
          1,
          Math.ceil(new TextEncoder().encode(serialized).byteLength / 4)
        );
        const neurons = Math.max(
          1,
          Math.ceil(
            ((inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000) *
              NEURON_BUFFER
          )
        );
        const debit = await reserveNeurons(budget, neurons);
        if (!debit || !debit.allowed) {
          throw budgetError(
            debit ? 'neuron_budget_exhausted' : 'neuron_budget_unavailable',
            debit?.used ?? null,
            debit?.remaining ?? null,
            debit?.retryAfter ?? null,
            debit?.dayKey ?? null
          );
        }
        return target.run.call(target, model, boundedInput, options);
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
    if (!response.ok) return null;
    const debit = (await response.json()) as Partial<DebitResult>;
    if (
      typeof debit.allowed !== 'boolean' ||
      !Number.isInteger(debit.used) ||
      debit.used! < 0 ||
      debit.used! > BUDGET_CAP ||
      !Number.isInteger(debit.remaining) ||
      debit.remaining! < 0 ||
      debit.remaining! > BUDGET_CAP ||
      debit.used! + debit.remaining! !== BUDGET_CAP ||
      !Number.isInteger(debit.retryAfter) ||
      debit.retryAfter! < 0 ||
      typeof debit.dayKey !== 'string' ||
      debit.dayKey !== new Date().toISOString().slice(0, 10)
    )
      return null;
    return debit as DebitResult;
  } catch {
    return null;
  }
}

function budgetError(
  code: string,
  used: number | null,
  remaining: number | null,
  retryAfter: number | null,
  dayKey: string | null
) {
  return Object.assign(
    new Error(
      used === null
        ? 'Workers AI daily budget state is unavailable.'
        : `Workers AI daily budget exhausted (${used}/${BUDGET_CAP}).`
    ),
    { code, used, remaining, retryAfter, dayKey }
  );
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}
