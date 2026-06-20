/** Local OpenAI-compatible chat helper (formerly @saas-maker/ai). */

export interface AIConfig {
  endpointUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
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

export function buildChatUrl(endpointUrl: string): string {
  const base = endpointUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export async function fetchChatCompletion(options: ChatCompletionOptions): Promise<Response> {
  const {
    config,
    messages,
    systemPrompt,
    maxTokens = 4096,
    stream = true,
    headers: extraHeaders = {},
  } = options;
  const url = buildChatUrl(config.endpointUrl);
  const allMessages: ChatMessage[] = [];
  if (systemPrompt) allMessages.push({ role: "system", content: systemPrompt });
  allMessages.push(...messages);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
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
