import { fetchChatCompletion, type AIConfig } from "./openai-chat";
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

export async function executePromptsWithAI(input: {
  env: Env;
  audit: AgentEvaluationInput;
  prompts: AgentPromptResult[];
}): Promise<AgentPromptResult[]> {
  const aiConfig = resolveEndpointConfig(input.env);
  if (!aiConfig) return input.prompts;
  return Promise.all(
    input.prompts.map(async (prompt) => {
      try {
        const response = await fetchChatCompletion({
          config: aiConfig,
          messages: [{ role: "user", content: prompt.promptText }],
          maxTokens: 600,
          stream: false,
        });
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
    }),
  );
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
    endpointUrl: env.HIGH_SIGNAL_AI_ENDPOINT_URL || "https://api.openai.com/v1/chat/completions",
    apiKey,
    model: env.HIGH_SIGNAL_AI_MODEL || "gpt-4o-mini",
  };
}
