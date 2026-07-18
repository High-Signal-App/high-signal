import { fetchChatCompletion, FREE_AI_DEFAULT_ENDPOINT } from "./ai-client";
import type { AIConfig } from "./ai-client";
import { fetchWithRetry, mapWithConcurrency } from "./resilience";
import type {
  AgentEvaluationCompetitor,
  AgentEvaluationInput,
  AgentPromptResult,
} from "@high-signal/shared";

type Env = {
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_API_KEY?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
  OPENAI_API_KEY?: string;
};

// Bounded concurrency for the prompt fan-out. Without this, Promise.all fires
// all prompts at once. 4 keeps us well under the gateway's per-project quota.
const AGENT_EVAL_CONCURRENCY = 4;
// Per-call timeout + bounded retry. Reuses the full-jitter discipline from
// resilience.ts. 2 attempts = one retry on 429/5xx/timeout.
const AGENT_EVAL_TIMEOUT_MS = 30_000;
const AGENT_EVAL_ATTEMPTS = 2;

export async function executePromptsWithAI(input: {
  env: Env;
  audit: AgentEvaluationInput;
  prompts: AgentPromptResult[];
}): Promise<AgentPromptResult[]> {
  const aiConfig = resolveEndpointConfig(input.env);
  if (!aiConfig) return input.prompts;
  // Bounded fan-out: a concurrency cap replaces the unbounded Promise.all so a
  // large prompt list cannot amplify into unbounded simultaneous provider calls.
  // The "return original prompt on failure" fallback is preserved per-item.
  const results = await mapWithConcurrency(
    input.prompts,
    AGENT_EVAL_CONCURRENCY,
    async (prompt) => {
      try {
        const response = await fetchWithRetry(
          (signal) =>
            fetchChatCompletion({
              config: aiConfig,
              messages: [{ role: "user", content: prompt.promptText }],
              maxTokens: 600,
              stream: false,
              headers: signal ? { "X-Request-Abort": signal.aborted ? "1" : "0" } : {},
            }),
          { attempts: AGENT_EVAL_ATTEMPTS, timeoutMs: AGENT_EVAL_TIMEOUT_MS },
        );
        if (!response.ok) return prompt;
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = (data.choices?.[0]?.message?.content ?? "").trim();
        if (!text) return prompt;
        return analyzeResponse({
          base: prompt,
          text,
          brandName: input.audit.brandName,
          brandUrl: input.audit.brandUrl,
          competitors: input.audit.competitors ?? [],
        });
      } catch {
        return prompt;
      }
    },
  );
  // Unwrap the result envelope — mapWithConcurrency never throws per-item
  // (errors become { ok: false }), and our callback already catches and
  // returns the original prompt, so every entry is ok. The index-based map
  // preserves order and falls back to the original prompt on any error.
  return results.map((r, i) => (r.ok ? r.value : input.prompts[i]!));
}

function analyzeResponse(input: {
  base: AgentPromptResult;
  text: string;
  brandName: string;
  brandUrl: string;
  competitors: AgentEvaluationCompetitor[];
}): AgentPromptResult {
  const brandPattern = new RegExp(`\\b${escape(input.brandName)}\\b`, "i");
  const brandMentioned = brandPattern.test(input.text);
  const recommendPattern = new RegExp(
    `\\b${escape(input.brandName)}[^.]{0,100}\\b(recommend|best|top|leading|pick|choose)`,
    "i",
  );
  const brandRecommended = recommendPattern.test(input.text);
  const competitorsMentioned = input.competitors
    .filter((c) => new RegExp(`\\b${escape(c.name)}\\b`, "i").test(input.text))
    .map((c) => ({ name: c.name, url: c.url }));
  const citations = Array.from(new Set(input.text.match(/https?:\/\/[^\s)>\]"',]+/g) ?? []));
  return {
    ...input.base,
    responseText: input.text.slice(0, 4000),
    brandMentioned,
    brandRecommended,
    competitorsMentioned,
    citations,
  };
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveEndpointConfig(env: Env): AIConfig | null {
  const apiKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    endpointUrl: env.HIGH_SIGNAL_AI_ENDPOINT_URL || FREE_AI_DEFAULT_ENDPOINT,
    apiKey,
    model: env.HIGH_SIGNAL_AI_MODEL || "auto",
  };
}
