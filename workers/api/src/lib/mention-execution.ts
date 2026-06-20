import { fetchChatCompletion, type AIConfig } from "./openai-chat";
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";

type Sentiment = "positive" | "neutral" | "negative";

type Env = {
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_API_KEY?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
  OPENAI_API_KEY?: string;
};

type ConfigRow = typeof schema.mentionBrandConfigs.$inferSelect;
type PromptRow = typeof schema.mentionPrompts.$inferSelect;

export interface MentionExecutionResult {
  brandMentioned: boolean;
  brandSentiment: Sentiment | null;
  brandPosition: number | null;
  competitorsMentioned: Array<{ name: string; mentioned: boolean; position: number | null }>;
  citations: string[];
  brandCited: boolean;
}

export async function runMentionCheck(input: {
  database: DB;
  env: Env;
  config: ConfigRow;
  prompts: PromptRow[];
  checkId: string;
}) {
  const endpointConfig = resolveEndpointConfig(input.config, input.env);
  if (!endpointConfig) {
    await markCheckFailed(
      input.database,
      input.checkId,
      "AI endpoint not configured. Set HIGH_SIGNAL_AI_API_KEY/OPENAI_API_KEY and model settings.",
    );
    return;
  }

  const brandAliases = stringArray(input.config.brandAliases);
  const competitors = objectArray<{ name: string }>(input.config.competitors).filter((item) =>
    Boolean(item.name),
  );
  let completedQueries = 0;
  let mentionCount = 0;

  try {
    for (const prompt of input.prompts) {
      try {
        const response = await queryEndpoint(endpointConfig, prompt.promptText);
        const analysis = analyzeMentionResponse({
          text: response.responseText,
          brandName: input.config.brandName,
          brandAliases,
          brandUrl: input.config.brandUrl,
          competitors,
        });

        if (analysis.brandMentioned) mentionCount++;
        await input.database.insert(schema.mentionResults).values({
          id: crypto.randomUUID(),
          checkId: input.checkId,
          configId: input.config.id,
          ownerId: input.config.ownerId,
          promptId: prompt.id,
          platform: "custom",
          model: response.model,
          responseText: response.responseText,
          brandMentioned: analysis.brandMentioned,
          brandSentiment: analysis.brandSentiment,
          brandPosition: analysis.brandPosition,
          competitorsMentioned: analysis.competitorsMentioned,
          citations: analysis.citations,
          brandCited: analysis.brandCited,
          latencyMs: response.latencyMs,
          createdAt: new Date(),
        });
      } catch (error) {
        await input.database.insert(schema.mentionResults).values({
          id: crypto.randomUUID(),
          checkId: input.checkId,
          configId: input.config.id,
          ownerId: input.config.ownerId,
          promptId: prompt.id,
          platform: "custom",
          model: endpointConfig.model,
          responseText: `Error: ${(error as Error).message}`,
          brandMentioned: false,
          brandSentiment: null,
          brandPosition: null,
          competitorsMentioned: [],
          citations: [],
          brandCited: false,
          latencyMs: null,
          createdAt: new Date(),
        });
      }

      completedQueries++;
      await input.database
        .update(schema.mentionChecks)
        .set({ completedQueries })
        .where(eq(schema.mentionChecks.id, input.checkId));
    }

    const totalQueries = Math.max(input.prompts.length, 1);
    const mentionRate = mentionCount / totalQueries;
    await input.database
      .update(schema.mentionChecks)
      .set({
        status: "completed",
        completedQueries,
        brandMentionRate: mentionRate,
        summary: `Brand mentioned in ${mentionCount}/${input.prompts.length} queries (${Math.round(
          mentionRate * 100,
        )}%)`,
        completedAt: new Date(),
      })
      .where(eq(schema.mentionChecks.id, input.checkId));
  } catch (error) {
    await markCheckFailed(input.database, input.checkId, `Check failed: ${(error as Error).message}`);
  }
}

export function analyzeMentionResponse(input: {
  text: string;
  brandName: string;
  brandAliases: string[];
  brandUrl: string | null;
  competitors: Array<{ name: string }>;
}): MentionExecutionResult {
  const allBrandTerms = [input.brandName, ...input.brandAliases].filter(Boolean);
  const brandMentioned = allBrandTerms.some((term) => wordRegex(term).test(input.text));
  const brandPosition = findListPosition(input.text, allBrandTerms);
  const brandSentiment = brandMentioned ? detectSentiment(input.text, allBrandTerms) : null;
  const competitorsMentioned = input.competitors.map((competitor) => ({
    name: competitor.name,
    mentioned: wordRegex(competitor.name).test(input.text),
    position: findListPosition(input.text, [competitor.name]),
  }));
  const citations = Array.from(new Set(input.text.match(/https?:\/\/[^\s)>\]"',]+/g) ?? []));
  const normalizedBrandUrl = input.brandUrl
    ?.toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const brandCited = normalizedBrandUrl
    ? citations.some((url) => url.toLowerCase().includes(normalizedBrandUrl))
    : false;

  return {
    brandMentioned,
    brandSentiment,
    brandPosition,
    competitorsMentioned,
    citations,
    brandCited,
  };
}

async function queryEndpoint(config: AIConfig, prompt: string) {
  const startedAt = Date.now();
  const response = await fetchChatCompletion({
    config,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1024,
    stream: false,
  });
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI endpoint error (${response.status}): ${text.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return {
    responseText: (json.choices?.[0]?.message?.content ?? "").slice(0, 4000),
    model: json.model || config.model,
    latencyMs,
  };
}

function resolveEndpointConfig(config: ConfigRow, env: Env): AIConfig | null {
  const apiKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  const model = config.aiModel || env.HIGH_SIGNAL_AI_MODEL || "gpt-4o-mini";
  if (!apiKey || !model) return null;
  return {
    endpointUrl:
      config.aiEndpointUrl || env.HIGH_SIGNAL_AI_ENDPOINT_URL || "https://api.openai.com/v1/chat/completions",
    apiKey,
    model,
  };
}

async function markCheckFailed(database: DB, checkId: string, summary: string) {
  await database
    .update(schema.mentionChecks)
    .set({ status: "failed", summary, completedAt: new Date() })
    .where(eq(schema.mentionChecks.id, checkId));
}

function detectSentiment(text: string, brandTerms: string[]): Sentiment {
  const positiveWords = [
    "best",
    "great",
    "excellent",
    "top",
    "leading",
    "popular",
    "powerful",
    "recommended",
    "reliable",
    "favorite",
    "preferred",
  ];
  const negativeWords = [
    "worst",
    "bad",
    "poor",
    "lacking",
    "limited",
    "expensive",
    "outdated",
    "difficult",
    "slow",
    "unreliable",
  ];
  const context = text
    .split(/[.!?]+/)
    .filter((sentence) => brandTerms.some((term) => wordRegex(term).test(sentence)))
    .join(" ")
    .toLowerCase();
  const positiveCount = positiveWords.filter((word) => context.includes(word)).length;
  const negativeCount = negativeWords.filter((word) => context.includes(word)).length;
  if (positiveCount > negativeCount) return "positive";
  if (negativeCount > positiveCount) return "negative";
  return "neutral";
}

function findListPosition(text: string, terms: string[]) {
  const listItemRegex = /^\s*(\d+)[.)]\s*\**\s*([^\n]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = listItemRegex.exec(text)) !== null) {
    if (terms.some((term) => wordRegex(term).test(match?.[2] ?? ""))) {
      return Number.parseInt(match[1] ?? "0", 10) || null;
    }
  }
  return null;
}

function wordRegex(term: string) {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function objectArray<T extends object>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => Boolean(item) && typeof item === "object");
}
