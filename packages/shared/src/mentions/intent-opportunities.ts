import { annotateLightweightNlp, type LightweightNlpAnnotation } from '../nlp';

export const COMMUNITY_INTENT_SOURCES = [
  'reddit',
  'hackernews',
  'stackexchange',
  'lobsters',
  'substack',
] as const;

export type IntentOpportunityStage =
  | 'awareness'
  | 'pain'
  | 'comparison'
  | 'purchase'
  | 'proof'
  | 'integration'
  | 'content';

export type IntentOpportunityAction =
  | 'watch'
  | 'reply'
  | 'create_proof'
  | 'improve_docs'
  | 'add_integration'
  | 'write_comparison'
  | 'content_opportunity';

export type IntentOpportunityInputEvent = {
  source: string;
  sourceUrl: string;
  title: string | null;
  content: string | null;
  publishedAt: Date;
};

export type IntentOpportunityBrandInput = {
  brandName: string;
  brandAliases?: string[];
  competitors?: Array<{ name?: string | null }>;
  nowMs?: number;
};

export type IntentOpportunityCandidate = {
  source: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceExcerpt: string;
  platform: string;
  intentStage: IntentOpportunityStage;
  actionType: IntentOpportunityAction;
  score: number;
  competitors: string[];
  matchedKeywords: string[];
  foundAt: Date;
};

export function keywordsForIntentBrand(input: IntentOpportunityBrandInput): string[] {
  return uniqueStrings([
    input.brandName,
    ...(input.brandAliases ?? []),
    ...((input.competitors ?? []).map((item) => item.name ?? '') ?? []),
  ]).filter((keyword) => keyword.length >= 2);
}

export function scoreIntentOpportunity(
  event: IntentOpportunityInputEvent,
  input: IntentOpportunityBrandInput
): IntentOpportunityCandidate | null {
  const keywords = keywordsForIntentBrand(input);
  if (keywords.length === 0) return null;

  const sourceTitle = (event.title ?? '').trim();
  const sourceExcerpt = truncateText((event.content ?? sourceTitle).replace(/\s+/g, ' '), 420);
  const text = `${sourceTitle}\n${sourceExcerpt}`.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  if (matchedKeywords.length === 0) return null;

  const annotation = annotateLightweightNlp(text);
  if (annotation.qualityGate.status === 'weak' && annotation.intent === 'general') return null;

  const competitors = (input.competitors ?? [])
    .map((competitor) => competitor.name?.trim())
    .filter((name): name is string => Boolean(name))
    .filter((name) => text.includes(name.toLowerCase()));
  const hasCompetitor = competitors.length > 0;
  const stage = intentStageFor(annotation.intent, annotation.requirementType, hasCompetitor);
  const actionType = actionTypeFor(stage, annotation.requirementType);
  const titleHit = matchedKeywords.some((keyword) =>
    sourceTitle.toLowerCase().includes(keyword.toLowerCase())
  );
  const recency = recencyScore(event.publishedAt, input.nowMs ?? Date.now());
  const score = Math.min(
    100,
    Math.round(
      annotation.opportunityScore * 55 +
        Math.min(matchedKeywords.length, 4) * 8 +
        (titleHit ? 10 : 0) +
        (hasCompetitor ? 8 : 0) +
        recency
    )
  );
  if (score < 35) return null;

  return {
    source: event.source,
    sourceUrl: event.sourceUrl,
    sourceTitle: sourceTitle || event.sourceUrl,
    sourceExcerpt,
    platform: event.source,
    intentStage: stage,
    actionType,
    score,
    competitors,
    matchedKeywords,
    foundAt: event.publishedAt,
  };
}

export function intentStageFor(
  intent: LightweightNlpAnnotation['intent'],
  requirementType: LightweightNlpAnnotation['requirementType'],
  hasCompetitor: boolean
): IntentOpportunityStage {
  if (hasCompetitor) return 'comparison';
  if (intent === 'purchase-intent') return 'purchase';
  if (requirementType === 'add-integration') return 'integration';
  if (requirementType === 'improve-pricing') return 'proof';
  if (intent === 'complaint' || intent === 'operational-risk' || requirementType === 'fix-bug')
    return 'pain';
  if (intent === 'feature-request' || requirementType === 'automate-workflow') return 'content';
  return 'awareness';
}

export function actionTypeFor(
  stage: IntentOpportunityStage,
  requirementType: LightweightNlpAnnotation['requirementType']
): IntentOpportunityAction {
  if (stage === 'comparison') return 'write_comparison';
  if (stage === 'purchase') return 'reply';
  if (stage === 'proof') return 'create_proof';
  if (stage === 'integration' || requirementType === 'add-integration') return 'add_integration';
  if (stage === 'pain') return 'improve_docs';
  if (stage === 'content') return 'content_opportunity';
  return 'watch';
}

function recencyScore(publishedAt: Date, nowMs: number) {
  const days = (nowMs - publishedAt.getTime()) / (24 * 3600 * 1000);
  if (days <= 1) return 14;
  if (days <= 3) return 10;
  if (days <= 7) return 6;
  return 2;
}

function truncateText(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}...`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
