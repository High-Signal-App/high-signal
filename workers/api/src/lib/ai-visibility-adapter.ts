import {
  ProviderUnavailableError,
  RetryableProviderError,
  executeVisibilityRun,
  resolvePlatforms,
  type BrandSubject,
  type JudgeAdapter,
  type PlatformEnv,
  type PromptDefinition,
  type ProviderAdapter,
  type ResolvedPlatform,
} from '@high-signal/shared';
import { fetchChatCompletion, FREE_AI_DEFAULT_ENDPOINT, type AIConfig } from './ai-client';
import { classifyStatus } from './resilience';

export interface HighSignalVisibilityConfig {
  brandName: string;
  brandAliases: string[];
  brandUrl: string | null;
  competitors: Array<{ name: string }>;
  aiEndpointUrl?: string | null;
  aiModel?: string | null;
}

export interface HighSignalVisibilityPrompt {
  id: string;
  promptText: string;
  persona?: string | null;
}

function toProviderAdapter(platform: ResolvedPlatform): ProviderAdapter {
  return {
    id: platform.platform,
    model: platform.model,
    grounded: platform.grounded,
    async execute({ prompt, signal }) {
      const response = await fetchChatCompletion({
        config: {
          endpointUrl: platform.endpointUrl,
          apiKey: platform.apiKey,
          model: platform.model,
        },
        messages: [{ role: 'user', content: prompt.text }],
        maxTokens: 1024,
        stream: false,
        signal,
      });
      if (!response.ok) {
        const classification = classifyStatus(response.status);
        const detail = (await response.text()).slice(0, 200);
        const message = `${platform.platform} endpoint error (${response.status}/${classification}): ${detail}`;
        if (classification === 'rate_limited' || classification === 'server_error') {
          throw new RetryableProviderError(message);
        }
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw new ProviderUnavailableError(message);
        }
        throw new Error(message);
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };
      return {
        text: (json.choices?.[0]?.message?.content ?? '').slice(0, 4000),
        model: json.model || platform.model,
      };
    },
  };
}

function resolveJudge(env: PlatformEnv): JudgeAdapter | undefined {
  const apiKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const config: AIConfig = {
    endpointUrl: env.HIGH_SIGNAL_AI_ENDPOINT_URL || FREE_AI_DEFAULT_ENDPOINT,
    apiKey,
    model: env.HIGH_SIGNAL_AI_MODEL || 'auto',
  };
  return {
    id: 'high-signal-judge',
    model: config.model,
    async judge({ prompt, signal }) {
      const response = await fetchChatCompletion({
        config,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 700,
        stream: false,
        signal,
      });
      if (!response.ok) throw new Error(`judge endpoint error (${response.status})`);
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content ?? '';
    },
  };
}

export function resolveHighSignalVisibilityProviders(
  env: PlatformEnv,
  config: HighSignalVisibilityConfig
): ProviderAdapter[] {
  return resolvePlatforms(env, {
    aiEndpointUrl: config.aiEndpointUrl,
    aiModel: config.aiModel,
  }).map(toProviderAdapter);
}

export async function executeHighSignalVisibility(input: {
  env: PlatformEnv;
  config: HighSignalVisibilityConfig;
  prompts: HighSignalVisibilityPrompt[];
}) {
  const providers = resolveHighSignalVisibilityProviders(input.env, input.config);
  const subject: BrandSubject = {
    brandName: input.config.brandName,
    brandAliases: input.config.brandAliases,
    brandUrl: input.config.brandUrl,
    competitors: input.config.competitors,
  };
  const prompts: PromptDefinition[] = input.prompts.map((prompt) => ({
    id: prompt.id,
    text: prompt.promptText,
    persona: prompt.persona ?? null,
  }));
  const judge = resolveJudge(input.env);
  return executeVisibilityRun({
    subject,
    prompts,
    providers,
    policy: {
      // High Signal preserves its existing matrix size while making that
      // ceiling explicit. Foundry consumers may choose a tighter budget.
      maxCalls: Math.max(prompts.length * providers.length, 1),
      maxConcurrency: 4,
      timeoutMs: 30_000,
      retryAttempts: 2,
      maxResponseCharacters: 4000,
    },
    ...(judge ? { judge } : {}),
  });
}
