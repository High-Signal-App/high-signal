// Local vendored AI client (formerly @saas-maker/ai). Posts to any
// OpenAI-compatible chat-completions endpoint. The Fleet default is the
// free-ai gateway, which requires a project id — sent here as the
// `X-Gateway-Project-Id` header (ignored by plain OpenAI-compatible providers
// when a user brings their own endpoint).

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
  stream?: boolean;
  headers?: Record<string, string>;
}

const PROJECT_ID = 'high-signal';

/** The Fleet AI chokepoint — used when no endpoint is explicitly configured. */
export const FREE_AI_DEFAULT_ENDPOINT =
  'https://ai-gateway.sassmaker.com/v1/chat/completions';

function buildChatUrl(endpointUrl: string): string {
  const base = endpointUrl.trim().replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/**
 * Raw fetch to an OpenAI-compatible chat completions endpoint. Returns the raw
 * Response so callers handle streaming or JSON parsing as needed.
 */
export async function fetchChatCompletion(options: ChatCompletionOptions): Promise<Response> {
  const { config, messages, systemPrompt, maxTokens = 4096, stream = true, headers: extraHeaders = {} } = options;
  const url = buildChatUrl(config.endpointUrl);
  const allMessages: ChatMessage[] = [];
  if (systemPrompt) allMessages.push({ role: 'system', content: systemPrompt });
  allMessages.push(...messages);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'X-Gateway-Project-Id': PROJECT_ID,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: config.model,
      messages: allMessages,
      max_tokens: maxTokens,
      stream,
    }),
  });
}
