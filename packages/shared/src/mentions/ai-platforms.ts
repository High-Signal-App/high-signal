// Multi-model fan-out for AI-visibility checks. GEO is fundamentally a
// cross-model question ("how does ChatGPT vs Gemini vs Perplexity vs Claude
// describe us?"), so a check runs each prompt against every provider whose key
// is configured, tagging results with the real platform instead of a single
// "custom" bucket. All providers are reached through their OpenAI-compatible
// chat-completions endpoint, so one client (fetchChatCompletion) serves all.
//
// Pure + deterministic: resolution takes a plain env object so it is unit
// testable without a worker. When no per-provider key is set it falls back to
// the single HIGH_SIGNAL_AI_* / OPENAI_API_KEY endpoint as platform "custom",
// preserving the prior single-model behaviour (no regression on a bare deploy).

export type AiPlatform = "chatgpt" | "gemini" | "perplexity" | "claude" | "custom";

export interface PlatformEnv {
  // Per-provider keys (each unlocks that platform column).
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // Single-endpoint fallback (the pre-existing config).
  HIGH_SIGNAL_AI_API_KEY?: string;
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
}

export interface ResolvedPlatform {
  platform: AiPlatform;
  endpointUrl: string;
  apiKey: string;
  model: string;
  /** Search-grounded providers actually emit source URLs, so citation/
   * cited-source analysis is only meaningful for these. */
  grounded: boolean;
}

interface PlatformSpec {
  platform: Exclude<AiPlatform, "custom">;
  envKey: keyof PlatformEnv;
  endpointUrl: string;
  model: string;
  grounded: boolean;
}

// Known providers and their OpenAI-compatible base URLs + a sensible default
// model. Models are overridable via <PLATFORM>_MODEL-style env later; kept as
// defaults here so a single key is enough to light up a platform.
export const PLATFORM_REGISTRY: PlatformSpec[] = [
  {
    platform: "chatgpt",
    envKey: "OPENAI_API_KEY",
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    grounded: false,
  },
  {
    platform: "perplexity",
    envKey: "PERPLEXITY_API_KEY",
    endpointUrl: "https://api.perplexity.ai/chat/completions",
    model: "sonar",
    grounded: true, // Perplexity answers cite live web sources.
  },
  {
    platform: "gemini",
    envKey: "GEMINI_API_KEY",
    endpointUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.0-flash",
    grounded: false,
  },
  {
    platform: "claude",
    envKey: "ANTHROPIC_API_KEY",
    endpointUrl: "https://api.anthropic.com/v1/chat/completions",
    model: "claude-3-5-haiku-latest",
    grounded: false,
  },
];

const FREE_AI_DEFAULT_ENDPOINT =
  "https://ai-gateway.sassmaker.com/v1/chat/completions";

/**
 * The platforms a check should fan out across, given the environment and an
 * optional per-brand endpoint override. Returns at least one platform whenever
 * *any* key is configured; an empty array means no AI is configured at all
 * (caller fail-closes with a clear message).
 */
export function resolvePlatforms(
  env: PlatformEnv,
  brandOverride?: { aiEndpointUrl?: string | null; aiModel?: string | null },
): ResolvedPlatform[] {
  const resolved: ResolvedPlatform[] = [];
  for (const spec of PLATFORM_REGISTRY) {
    const apiKey = env[spec.envKey];
    if (apiKey) {
      resolved.push({
        platform: spec.platform,
        endpointUrl: spec.endpointUrl,
        apiKey,
        model: spec.model,
        grounded: spec.grounded,
      });
    }
  }

  // A brand that brought its own endpoint always gets its own "custom" column.
  const customKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  const brandEndpoint = brandOverride?.aiEndpointUrl?.trim();
  if (brandEndpoint && customKey) {
    resolved.push({
      platform: "custom",
      endpointUrl: brandEndpoint,
      apiKey: customKey,
      model: brandOverride?.aiModel?.trim() || env.HIGH_SIGNAL_AI_MODEL || "auto",
      grounded: false,
    });
  }

  // Fallback: no per-provider platform resolved → single custom endpoint, so a
  // bare deploy still runs exactly as before.
  if (resolved.length === 0 && customKey) {
    resolved.push({
      platform: "custom",
      endpointUrl: env.HIGH_SIGNAL_AI_ENDPOINT_URL || FREE_AI_DEFAULT_ENDPOINT,
      apiKey: customKey,
      model: env.HIGH_SIGNAL_AI_MODEL || "auto",
      grounded: false,
    });
  }

  return resolved;
}

/** Distinct platform labels a resolution will produce — for progress/UI. */
export function resolvedPlatformLabels(platforms: ResolvedPlatform[]): AiPlatform[] {
  return Array.from(new Set(platforms.map((p) => p.platform)));
}
