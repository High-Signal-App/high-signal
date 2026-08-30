import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';

export interface AIConfig {
  binding?: Ai;
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
  const { config, messages, systemPrompt, maxTokens = 4096, signal } = options;
  const model = config.binding
    ? createWorkersAI({ binding: config.binding })(config.model)
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

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}
