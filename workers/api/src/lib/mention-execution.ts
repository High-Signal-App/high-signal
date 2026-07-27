import { analyzeMentionResponse, type MentionAnalysis } from '@high-signal/shared';
import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { schema } from '../db';
import { executeHighSignalVisibility } from './ai-visibility-adapter';

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

export { analyzeMentionResponse };
export type MentionExecutionResult = MentionAnalysis;

export async function runMentionCheck(input: {
  database: DB;
  env: Env;
  config: ConfigRow;
  prompts: PromptRow[];
  checkId: string;
}) {
  try {
    await runMentionCheckInternal(input);
  } catch (error) {
    await markCheckFailed(
      input.database,
      input.checkId,
      `Check failed: ${(error as Error).message}`
    );
  }
}

async function runMentionCheckInternal(input: {
  database: DB;
  env: Env;
  config: ConfigRow;
  prompts: PromptRow[];
  checkId: string;
}) {
  const brandAliases = stringArray(input.config.brandAliases);
  const competitors = objectArray<{ name: string }>(input.config.competitors).filter((item) =>
    Boolean(item.name)
  );
  const run = await executeHighSignalVisibility({
    env: input.env,
    config: {
      brandName: input.config.brandName,
      brandAliases,
      brandUrl: input.config.brandUrl,
      competitors,
      aiEndpointUrl: input.config.aiEndpointUrl,
      aiModel: input.config.aiModel,
    },
    prompts: input.prompts.map((prompt) => ({
      id: prompt.id,
      promptText: prompt.promptText,
      persona: prompt.persona,
    })),
  });

  if (run.attempts.length === 0) {
    await markCheckFailed(
      input.database,
      input.checkId,
      'AI endpoint not configured. Set a provider key (OPENAI/GEMINI/PERPLEXITY/ANTHROPIC) or HIGH_SIGNAL_AI_API_KEY.'
    );
    return;
  }

  const totalQueries = run.attempts.length;
  await input.database
    .update(schema.mentionChecks)
    .set({ totalQueries })
    .where(eq(schema.mentionChecks.id, input.checkId));

  let completedQueries = 0;
  let mentionCount = 0;
  for (const attempt of run.attempts) {
    const prompt = input.prompts.find((item) => item.id === attempt.promptId);
    if (!prompt) {
      await markCheckFailed(
        input.database,
        input.checkId,
        `Check failed: missing prompt ${attempt.promptId}`
      );
      return;
    }
    if (attempt.analysis && (attempt.status === 'completed' || attempt.status === 'cached')) {
      if (attempt.analysis.brandMentioned) mentionCount++;
      await input.database.insert(schema.mentionResults).values({
        id: crypto.randomUUID(),
        checkId: input.checkId,
        configId: input.config.id,
        ownerId: input.config.ownerId,
        promptId: prompt.id,
        platform: attempt.providerId,
        model: attempt.model,
        persona: prompt.persona ?? null,
        responseText: attempt.responseText ?? '',
        brandMentioned: attempt.analysis.brandMentioned,
        brandRecommended: attempt.analysis.brandRecommended,
        brandSentiment: attempt.analysis.brandSentiment,
        brandPosition: attempt.analysis.brandPosition,
        competitorsMentioned: attempt.analysis.competitorsMentioned,
        citations: attempt.analysis.citations,
        brandCited: attempt.analysis.brandCited,
        judgeReasoning: attempt.analysis.reasoning || null,
        latencyMs: attempt.latencyMs,
        createdAt: new Date(),
      });
    } else {
      await input.database.insert(schema.mentionResults).values({
        id: crypto.randomUUID(),
        checkId: input.checkId,
        configId: input.config.id,
        ownerId: input.config.ownerId,
        promptId: prompt.id,
        platform: attempt.providerId,
        model: attempt.model,
        persona: prompt.persona ?? null,
        responseText: `Error: ${attempt.error ?? attempt.status}`,
        brandMentioned: false,
        brandRecommended: false,
        brandSentiment: null,
        brandPosition: null,
        competitorsMentioned: [],
        citations: [],
        brandCited: false,
        judgeReasoning: null,
        latencyMs: attempt.latencyMs,
        createdAt: new Date(),
      });
    }

    completedQueries++;
    await input.database
      .update(schema.mentionChecks)
      .set({ completedQueries })
      .where(eq(schema.mentionChecks.id, input.checkId));
  }

  const mentionRate = mentionCount / Math.max(totalQueries, 1);
  const platformLabels = Array.from(new Set(run.attempts.map((attempt) => attempt.providerId)));
  await input.database
    .update(schema.mentionChecks)
    .set({
      status: 'completed',
      completedQueries,
      brandMentionRate: mentionRate,
      summary: `Brand mentioned in ${mentionCount}/${totalQueries} answers (${Math.round(
        mentionRate * 100
      )}%) across ${platformLabels.length} engine${platformLabels.length === 1 ? '' : 's'}: ${platformLabels.join(', ')}`,
      completedAt: new Date(),
    })
    .where(eq(schema.mentionChecks.id, input.checkId));
}

async function markCheckFailed(database: DB, checkId: string, summary: string) {
  await database
    .update(schema.mentionChecks)
    .set({ status: 'failed', summary, completedAt: new Date() })
    .where(eq(schema.mentionChecks.id, checkId));
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function objectArray<T extends object>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => Boolean(item) && typeof item === 'object');
}
