import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

export interface AIConfig {
  endpointUrl: string;
  apiKey: string;
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
  const { config, messages, systemPrompt, maxTokens = 4096, signal } = options;
  const provider = createOpenAICompatible({
    name: 'high-signal-direct',
    baseURL: config.endpointUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey,
  });
  const result = await generateText({
    model: provider.chatModel(config.model),
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages,
    maxOutputTokens: maxTokens,
    maxRetries: 0,
    abortSignal: signal,
  });
  return result.text;
}
