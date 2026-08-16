/**
 * Pure brief composition helpers: ranking, hit-rate, seed rendering, and
 * section-merge. Query modules own D1; this file must stay side-effect free
 * aside from the fault-isolation wrappers.
 */

import {
  BUNDLED_D2C_ARTIFACT,
  d2cBriefItems,
  familyForSignalType,
  findSeedProduct,
  isPredictionMarketOnly,
  SEED_PRODUCTS,
  type BriefCategoryState,
  type BriefIdeaItem,
  type BriefImprovementItem,
  type BriefIntentItem,
  type BriefPerceptionItem,
  type HitRateBand,
  type Region,
  type SeedProduct,
  type SignalFamily,
} from '@high-signal/shared';

// Operational safety bounds, not editorial targets. Composition never weakens
// a quality gate to fill these values; strong coverage days may use the room.
export const STOCKS_LIMIT = 24;
export const IDEAS_LIMIT = 20;
export const TRENDS_LIMIT = 20;
/**
 * 4-week window. Sarthak's 2026-05-25 directive: "sync at least 4 weeks of
 * data everywhere." The public brief reads only from real D1 evidence.
 */
export const RECENT_SIGNAL_WINDOW_DAYS = 28;
export const COMMUNITY_DIGEST_LOOKBACK_DAYS = 28;
/**
 * "Direct" hit-rate confidence requires ≥ 3 scored predictions on the exact
 * signal_type. Below that, fall back to family or `early` so the moat stays
 * visible instead of going silent on fresh signal types.
 */
export const HIT_RATE_SAMPLE_MIN = 3;
export const HIT_RATE_FAMILY_MIN = 5;

/** Pure ranking helper — tested directly. */
export interface RankableRow {
  direction: 'up' | 'down' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
}
export function rankStocks<T extends RankableRow>(rows: T[]): T[] {
  const dirWeight = (d: string) => (d === 'up' ? 0 : d === 'down' ? 1 : 2);
  const confWeight = (c: string) => (c === 'high' ? 0 : c === 'medium' ? 1 : 2);
  return rows.slice().sort((a, b) => {
    const direction = dirWeight(a.direction) - dirWeight(b.direction);
    if (direction !== 0) return direction;
    return confWeight(a.confidence) - confWeight(b.confidence);
  });
}

/** Read-time defense for legacy published signals that predate cite-or-kill. */
export function isBriefStockEvidenceEligible(urls: readonly string[]): boolean {
  const unique = Array.from(new Set(urls.map((url) => url.trim()).filter(isPublicSourceLink)));
  return unique.length >= 2 && !isPredictionMarketOnly(unique);
}

/** Community brief inputs must carry a safe public source thread. */
export function isPublicSourceLink(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Compute hit-rate from a bag of outcomes, applying the sample-size gate.
 * Returns null when there are fewer than HIT_RATE_SAMPLE_MIN decided outcomes
 * (hit + miss). Push doesn't count toward the sample.
 */
export function computeHitRate(outcomes: { hit: number; miss: number; push: number }): {
  hitRate: number | null;
  sample: number;
} {
  const decided = outcomes.hit + outcomes.miss;
  if (decided < HIT_RATE_SAMPLE_MIN) {
    return { hitRate: null, sample: decided };
  }
  return { hitRate: outcomes.hit / decided, sample: decided };
}

export interface BucketCounts {
  hit: number;
  miss: number;
  push: number;
}

/**
 * Three-tier hit-rate resolution. Tries the exact signal_type first; if not
 * enough sample, falls back to the family aggregate; if family is also too
 * thin but has any scored decision, surfaces it as "early"; otherwise null.
 */
export function resolveHitRate(
  signalType: string,
  byType: Map<string, BucketCounts>,
  byFamily: Map<SignalFamily, BucketCounts>
): { hitRate: number | null; sample: number; band: HitRateBand } {
  const direct = byType.get(signalType);
  if (direct) {
    const decided = direct.hit + direct.miss;
    if (decided >= HIT_RATE_SAMPLE_MIN) {
      return { hitRate: direct.hit / decided, sample: decided, band: 'direct' };
    }
  }
  const family = familyForSignalType(signalType);
  const familyBucket = byFamily.get(family);
  if (familyBucket) {
    const decided = familyBucket.hit + familyBucket.miss;
    if (decided >= HIT_RATE_FAMILY_MIN) {
      return { hitRate: familyBucket.hit / decided, sample: decided, band: 'family' };
    }
    if (decided >= 1) {
      return { hitRate: familyBucket.hit / decided, sample: decided, band: 'early' };
    }
  }
  if (direct) {
    const decided = direct.hit + direct.miss;
    if (decided >= 1) {
      return { hitRate: direct.hit / decided, sample: decided, band: 'early' };
    }
  }
  return { hitRate: null, sample: 0, band: 'none' };
}

/** Extract a one-line headline from a signal's body markdown, falling back to entity name. */
export function headlineFromBody(bodyMd: string, fallback: string): string {
  const firstLine = (bodyMd ?? '').split('\n').find((line) => line.trim());
  if (!firstLine) return fallback;
  return (
    firstLine
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 180) || fallback
  );
}

export function renderFromSeed(productId: string): {
  perception: BriefPerceptionItem[];
  improvements: BriefImprovementItem[];
} | null {
  const product = findSeedProduct(productId);
  if (!product) return null;
  return seedToBrief(product);
}

export function pickSpotlight(region: Region, nowMs: number = Date.now()): SeedProduct | null {
  const pool =
    region === 'global' ? SEED_PRODUCTS : SEED_PRODUCTS.filter((p) => p.region === region);
  if (pool.length === 0) return null;
  const hourBucket = Math.floor(nowMs / (1000 * 60 * 60));
  return pool[hourBucket % pool.length] ?? null;
}

/**
 * Run a non-public builder and absorb an independent failure.
 */
export async function safe<T>(builder: () => Promise<T[]>, section: string): Promise<T[]> {
  try {
    return await builder();
  } catch (error) {
    console.warn(`[brief] ${section} builder failed`, error);
    return [];
  }
}

export interface PublicCategoryResult<T> {
  items: T[];
  state: BriefCategoryState;
}

/** Public categories expose failure instead of disguising it as demo data. */
export async function safeCategory<T>(
  builder: () => Promise<T[]>,
  section: string
): Promise<PublicCategoryResult<T>> {
  try {
    const items = await builder();
    return {
      items,
      state: {
        status: items.length > 0 ? 'ready' : 'empty',
        source: 'live',
        reason: items.length > 0 ? null : 'no_qualifying_items',
      },
    };
  } catch (error) {
    console.warn(`[brief] ${section} builder unavailable`, error);
    return {
      items: [],
      state: { status: 'unavailable', source: 'live', reason: 'builder_failed' },
    };
  }
}

/**
 * Add the highest-scoring open intent finding to each connected brand's
 * perception row. Intent-only brands remain visible with unavailable metrics.
 */
export function mergeIntentIntoPerception(
  perception: BriefPerceptionItem[],
  intents: BriefIntentItem[]
): BriefPerceptionItem[] {
  if (intents.length === 0) return perception;
  const topByBrand = new Map<string, BriefIntentItem>();
  for (const intent of intents) {
    const current = topByBrand.get(intent.brandId);
    if (!current || intent.score > current.score) topByBrand.set(intent.brandId, intent);
  }

  const existingBrands = new Set(perception.map((item) => item.configId));
  const enriched = perception.map((item) => ({
    ...item,
    ...(topByBrand.has(item.configId) ? { topIntent: topByBrand.get(item.configId) } : {}),
  }));
  for (const [brandId, intent] of topByBrand) {
    if (existingBrands.has(brandId)) continue;
    enriched.push({
      brandName: intent.brandName,
      mentionRate: null,
      positiveShare: null,
      competitorPresence: null,
      latestCheckAt: null,
      configId: brandId,
      topIntent: intent,
    });
  }
  return enriched;
}

const intentPriority = (score: number): 'high' | 'medium' | 'low' =>
  score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';

const intentActionCopy = (intent: BriefIntentItem): { area: string; task: string } | null => {
  const title =
    intent.sourceTitle.length > 100
      ? `${intent.sourceTitle.slice(0, 99).trim()}...`
      : intent.sourceTitle;
  switch (intent.actionType) {
    case 'reply':
      return { area: 'buyer response', task: `Review and reply to buyer intent: ${title}` };
    case 'create_proof':
      return { area: 'proof', task: `Add proof for buyer question: ${title}` };
    case 'improve_docs':
      return { area: 'docs', task: `Clarify the docs or support gap behind: ${title}` };
    case 'add_integration':
      return { area: 'integrations', task: `Validate and document integration demand: ${title}` };
    case 'write_comparison':
      return { area: 'comparisons', task: `Publish a sourced comparison response for: ${title}` };
    case 'content_opportunity':
      return { area: 'positioning', task: `Create a sourced answer for: ${title}` };
    case 'watch':
      return null;
  }
};

/**
 * Attach intent evidence to matching Agent Eval tasks, then synthesize actions
 * only for findings that are not already represented by the same source URL.
 */
export function mergeIntentIntoImprovements(
  improvements: BriefImprovementItem[],
  intents: BriefIntentItem[]
): BriefImprovementItem[] {
  if (intents.length === 0) return improvements;
  const bySource = new Map<string, number>();
  const merged = improvements.map((item, index) => {
    if (item.sourceUrl) bySource.set(item.sourceUrl, index);
    return { ...item };
  });

  for (const intent of intents) {
    const existingIndex = bySource.get(intent.sourceUrl);
    if (existingIndex !== undefined) {
      merged[existingIndex] = { ...merged[existingIndex], intent };
      continue;
    }
    const action = intentActionCopy(intent);
    if (!action) continue;
    bySource.set(intent.sourceUrl, merged.length);
    merged.push({
      brandName: intent.brandName,
      area: action.area,
      task: action.task,
      priority: intentPriority(intent.score),
      auditId: null,
      surfacedAt: intent.foundAt,
      sourceUrl: intent.sourceUrl,
      intent,
    });
  }

  const priorityWeight = { high: 0, medium: 1, low: 2 } as const;
  return merged
    .sort((a, b) => {
      const priority = priorityWeight[a.priority] - priorityWeight[b.priority];
      if (priority !== 0) return priority;
      return (b.intent?.score ?? -1) - (a.intent?.score ?? -1);
    })
    .slice(0, 8);
}

export function seedToBrief(
  product: SeedProduct,
  nowIso: string = new Date().toISOString()
): {
  perception: BriefPerceptionItem[];
  improvements: BriefImprovementItem[];
} {
  return {
    perception: [
      {
        brandName: product.brandName,
        mentionRate: product.perception.mentionRate,
        positiveShare: product.perception.positiveShare,
        competitorPresence: product.perception.competitorPresence,
        latestCheckAt: nowIso,
        configId: `seed:${product.id}`,
      },
    ],
    improvements: product.improvements.map((improvement) => ({
      brandName: product.brandName,
      area: improvement.area,
      task: improvement.task,
      priority: improvement.priority,
      auditId: `seed:${product.id}`,
      surfacedAt: nowIso,
    })),
  };
}

/**
 * India D2C Opportunity Briefs for section 02. Up to 3 for south-asia, 1
 * rotating for global, none for other regions. Uses the build-time bundled
 * artifact when present, otherwise seed-only briefs.
 */
export function d2cBriefItemsForRegion(region: Region): BriefIdeaItem[] {
  if (region !== 'south-asia' && region !== 'global') return [];
  const limit = region === 'south-asia' ? 3 : 1;
  // Rotate one niche per day so the global brief shows variety across the
  // 20-niche pool without flooding section 02 with India-only items.
  const rotateFor = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return d2cBriefItems(region, limit, BUNDLED_D2C_ARTIFACT, rotateFor);
}
