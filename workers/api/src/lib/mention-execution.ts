import { fetchChatCompletion, FREE_AI_DEFAULT_ENDPOINT } from "./ai-client";
import { eq } from "drizzle-orm";
import type { AIConfig } from "./ai-client";
import type { DB } from "../db";
import { schema } from "../db";
import {
  buildMentionJudgePrompt,
  parseMentionVerdict,
  resolvePlatforms,
  type MentionVerdict,
  type ResolvedPlatform,
} from "@high-signal/shared";

type Sentiment = "positive" | "neutral" | "negative";

// Per-provider keys unlock multi-model fan-out; the HIGH_SIGNAL_AI_* /
// OPENAI_API_KEY pair is the single-endpoint fallback + the LLM judge.
type Env = {
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_API_KEY?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
};

type ConfigRow = typeof schema.mentionBrandConfigs.$inferSelect;
type PromptRow = typeof schema.mentionPrompts.$inferSelect;

// Unified analysis shape (judge verdict OR deterministic fallback map to this).
export interface MentionExecutionResult {
  brandMentioned: boolean;
  brandRecommended: boolean;
  brandSentiment: Sentiment | null;
  brandPosition: number | null;
  competitorsMentioned: Array<{ name: string; mentioned: boolean; position: number | null }>;
  citations: string[];
  brandCited: boolean;
  reasoning: string;
}

export async function runMentionCheck(input: {
  database: DB;
  env: Env;
  config: ConfigRow;
  prompts: PromptRow[];
  checkId: string;
}) {
  const platforms = resolvePlatforms(input.env, {
    aiEndpointUrl: input.config.aiEndpointUrl,
    aiModel: input.config.aiModel,
  });
  if (platforms.length === 0) {
    await markCheckFailed(
      input.database,
      input.checkId,
      "AI endpoint not configured. Set a provider key (OPENAI/GEMINI/PERPLEXITY/ANTHROPIC) or HIGH_SIGNAL_AI_API_KEY.",
    );
    return;
  }
  const judgeConfig = resolveJudgeConfig(input.env);

  const brandAliases = stringArray(input.config.brandAliases);
  const competitors = objectArray<{ name: string }>(input.config.competitors).filter((item) =>
    Boolean(item.name),
  );

  // Fan-out is prompts × platforms. Reflect that in the check's total so the
  // progress bar is honest about cross-model work.
  const totalQueries = input.prompts.length * platforms.length;
  await input.database
    .update(schema.mentionChecks)
    .set({ totalQueries })
    .where(eq(schema.mentionChecks.id, input.checkId));

  let completedQueries = 0;
  let mentionCount = 0;

  try {
    for (const prompt of input.prompts) {
      for (const platform of platforms) {
        try {
          const response = await queryEndpoint(platform, prompt.promptText);
          const analysis = await analyzeResponse({
            judgeConfig,
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
            platform: platform.platform,
            model: response.model,
            persona: prompt.persona ?? null,
            responseText: response.responseText,
            brandMentioned: analysis.brandMentioned,
            brandRecommended: analysis.brandRecommended,
            brandSentiment: analysis.brandSentiment,
            brandPosition: analysis.brandPosition,
            competitorsMentioned: analysis.competitorsMentioned,
            citations: analysis.citations,
            brandCited: analysis.brandCited,
            judgeReasoning: analysis.reasoning || null,
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
            platform: platform.platform,
            model: platform.model,
            persona: prompt.persona ?? null,
            responseText: `Error: ${(error as Error).message}`,
            brandMentioned: false,
            brandRecommended: false,
            brandSentiment: null,
            brandPosition: null,
            competitorsMentioned: [],
            citations: [],
            brandCited: false,
            judgeReasoning: null,
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
    }

    const denom = Math.max(totalQueries, 1);
    const mentionRate = mentionCount / denom;
    const platformLabels = Array.from(new Set(platforms.map((p) => p.platform)));
    await input.database
      .update(schema.mentionChecks)
      .set({
        status: "completed",
        completedQueries,
        brandMentionRate: mentionRate,
        summary: `Brand mentioned in ${mentionCount}/${totalQueries} answers (${Math.round(
          mentionRate * 100,
        )}%) across ${platformLabels.length} engine${platformLabels.length === 1 ? "" : "s"}: ${platformLabels.join(", ")}`,
        completedAt: new Date(),
      })
      .where(eq(schema.mentionChecks.id, input.checkId));
  } catch (error) {
    await markCheckFailed(input.database, input.checkId, `Check failed: ${(error as Error).message}`);
  }
}

// Judge-first analysis: an LLM grades the answer (negation-aware sentiment,
// prose ranking, real recommendation) and returns strict JSON. On any failure
// we fall back to the deterministic analyzer so a check never stalls on the
// grader.
async function analyzeResponse(input: {
  judgeConfig: AIConfig | null;
  text: string;
  brandName: string;
  brandAliases: string[];
  brandUrl: string | null;
  competitors: Array<{ name: string }>;
}): Promise<MentionExecutionResult> {
  if (input.judgeConfig && input.text.trim()) {
    try {
      const prompt = buildMentionJudgePrompt(
        {
          brandName: input.brandName,
          brandAliases: input.brandAliases,
          brandUrl: input.brandUrl,
          competitors: input.competitors,
        },
        input.text,
      );
      const res = await fetchChatCompletion({
        config: input.judgeConfig,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 700,
        stream: false,
      });
      if (res.ok) {
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const verdict = parseMentionVerdict(
          json.choices?.[0]?.message?.content ?? "",
          input.competitors,
        );
        if (verdict) return fromVerdict(verdict);
      }
    } catch {
      /* fall through to deterministic */
    }
  }
  return analyzeMentionResponse(input);
}

function fromVerdict(v: MentionVerdict): MentionExecutionResult {
  return {
    brandMentioned: v.brandMentioned,
    brandRecommended: v.brandRecommended,
    brandSentiment: v.brandSentiment,
    brandPosition: v.brandPosition,
    competitorsMentioned: v.competitorsMentioned,
    citations: v.citations,
    brandCited: v.brandCited,
    reasoning: v.reasoning,
  };
}

// Deterministic fallback — keyword/regex analysis. Coarse (no negation) but
// dependable when no judge is configured or the judge misbehaves.
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
  const brandRecommended = brandMentioned && detectRecommended(input.text, allBrandTerms);
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
    brandRecommended,
    brandSentiment,
    brandPosition,
    competitorsMentioned,
    citations,
    brandCited,
    reasoning: "",
  };
}

async function queryEndpoint(platform: ResolvedPlatform, prompt: string) {
  const startedAt = Date.now();
  const config: AIConfig = {
    endpointUrl: platform.endpointUrl,
    apiKey: platform.apiKey,
    model: platform.model,
  };
  const response = await fetchChatCompletion({
    config,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1024,
    stream: false,
  });
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${platform.platform} endpoint error (${response.status}): ${text.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return {
    responseText: (json.choices?.[0]?.message?.content ?? "").slice(0, 4000),
    model: json.model || platform.model,
    latencyMs,
  };
}

// The grader endpoint — the primary single-endpoint config (free-ai gateway by
// default). Independent of which models we probe.
function resolveJudgeConfig(env: Env): AIConfig | null {
  const apiKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    endpointUrl: env.HIGH_SIGNAL_AI_ENDPOINT_URL || FREE_AI_DEFAULT_ENDPOINT,
    apiKey,
    model: env.HIGH_SIGNAL_AI_MODEL || "auto",
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

function detectRecommended(text: string, brandTerms: string[]): boolean {
  const recWords = /(recommend|best|top choice|go with|ideal|great choice|preferred|our pick|the winner)/i;
  return text
    .split(/[.!?]+/)
    .some((sentence) => brandTerms.some((term) => wordRegex(term).test(sentence)) && recWords.test(sentence));
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
