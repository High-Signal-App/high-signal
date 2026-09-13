/**
 * Pure brief composition helpers: ranking, hit-rate, and section merge.
 * Query modules own D1; this file must stay side-effect free
 * aside from the fault-isolation wrappers.
 */

import {
  familyForSignalType,
  publishability,
  type BriefCategoryState,
  type BriefNewsItem,
  type BriefSnapshot,
  type HitRateBand,
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
  verifiedOriginCount?: number;
  qualityScore?: number;
  publishedAt?: string | number | Date;
}
export function rankStocks<T extends RankableRow>(rows: T[]): T[] {
  const confWeight = (c: string) => (c === 'high' ? 0 : c === 'medium' ? 1 : 2);
  const dirWeight = (d: string) => (d === 'up' ? 0 : d === 'down' ? 1 : 2);
  const time = (value: RankableRow['publishedAt']) => {
    if (value == null) return 0;
    const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return rows.slice().sort((a, b) => {
    const origins = (b.verifiedOriginCount ?? 0) - (a.verifiedOriginCount ?? 0);
    if (origins !== 0) return origins;
    const quality = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    if (quality !== 0) return quality;
    const confidence = confWeight(a.confidence) - confWeight(b.confidence);
    if (confidence !== 0) return confidence;
    const freshness = time(b.publishedAt) - time(a.publishedAt);
    if (freshness !== 0) return freshness;
    return dirWeight(a.direction) - dirWeight(b.direction);
  });
}

/** Read-time defense for legacy published signals that predate cite-or-kill. */
export function isBriefStockEvidenceEligible(urls: readonly string[]): boolean {
  const unique = Array.from(new Set(urls.map((url) => url.trim()).filter(isPublicSourceLink)));
  return publishability({ evidenceUrls: unique, qualityEligible: unique.length >= 2 }).publishable;
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
  const firstLine = (bodyMd ?? '').split('\n').find((line) => {
    const text = line.replace(/^#+\s*/, '').trim();
    return text && !/^(what changed|why it matters|uncertainty|risks?)[:?]?$/i.test(text);
  });
  if (!firstLine) return fallback;
  const headline = firstLine.replace(/^#+\s*/, '').trim();
  if (!headline) return fallback;
  if (headline.length <= 160) return headline;

  const wordBoundary = headline.slice(0, 161).lastIndexOf(' ');
  const cutoff = wordBoundary >= 120 ? wordBoundary : 160;
  return `${headline.slice(0, cutoff).replace(/[,:;\-–—]+$/, '')}…`;
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

/** News is independent of market-signal publish gates and snapshot history. */
export function withBriefNews(snapshot: BriefSnapshot, news: BriefNewsItem[]): BriefSnapshot {
  return { ...snapshot, news };
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
