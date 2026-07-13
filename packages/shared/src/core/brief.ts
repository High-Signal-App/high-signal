/**
 * Daily Brief contract. The brief has 3 public sections plus 2 personal
 * sections that appear once a brand is connected.
 *
 * Each item carries enough metadata for the renderer to show evidence inline
 * (citations + hit-rate where applicable) without a second round-trip.
 */

import type { Region } from "../primitives/region";
import type { BriefClaimProvenance } from "./claim-provenance";

export type BriefSectionKey =
  | "stocks"
  | "ideas"
  | "trends"
  | "perception"
  | "improvements";

export interface BriefCitation {
  url: string;
  source?: string | null;
}

export type OpportunityVerdict = "enter" | "test" | "watch" | "avoid";

export interface OpportunityEvidenceMixItem {
  kind: "demand" | "competition" | "pricing" | "agent-visibility" | "momentum";
  label: string;
  summary: string;
  strength: "low" | "medium" | "high";
  sourceCount: number;
}

export interface OpportunityHitRateContext {
  label: string;
  hitRate: number | null;
  sample: number;
  band: HitRateBand;
}

export interface OpportunityBriefPayload {
  verdict: OpportunityVerdict;
  confidence: "low" | "medium" | "high";
  targetUser: string;
  problem: string;
  marketTimingReasons: string[];
  evidenceMix: OpportunityEvidenceMixItem[];
  competitorNotes: string[];
  pricingNotes: string[];
  agentVisibilityNotes: string[];
  risks: string[];
  nextValidationStep: string;
  priorHitRate: OpportunityHitRateContext | null;
}

/**
 * How the inline hit-rate column on a stock card should render.
 *
 * - `direct`: enough scored predictions on this exact signal_type to quote
 *   the rate with confidence.
 * - `family`: not enough on the exact type yet, so we show the broader
 *   *family* hit-rate (capex/order-book → "supply-demand", etc.) — still
 *   useful, lower-precision.
 * - `early`: a small live sample (1–2 scored calls) exists; we surface the
 *   number with an "early" qualifier so users see motion, not silence.
 * - `none`: no scored predictions anywhere in the family — render "no live
 *   calls yet" and the project gets to keep its honesty.
 */
export type HitRateBand = "direct" | "family" | "early" | "none";

export interface BriefStockItem {
  entityId: string;
  entityName: string;
  ticker: string | null;
  country: string | null;
  signalType: string;
  signalFamily: string;
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
  predictedWindowDays: number;
  headline: string;
  signalSlug: string;
  publishedAt: string;
  evidenceUrls: BriefCitation[];
  /**
   * Project's prior hit-rate on this signal type or family. Null only when
   * the family also has no scored calls. Always paired with `hitRateBand`
   * so the renderer can label precision accurately.
   */
  hitRate: number | null;
  hitRateSample: number;
  hitRateBand: HitRateBand;
  /** Optional on legacy/precomputed snapshots while claim coverage backfills. */
  provenance?: BriefClaimProvenance;
}

export interface BriefWatchingItem {
  signalId: string;
  signalSlug: string;
  signalType: string;
  headline: string;
  watchedEntityId: string;
  watchedEntityName: string;
  subjectEntityId: string;
  subjectEntityName: string;
  deltaKind: "direct" | "second_order";
  observed: boolean;
  confidence: "low" | "medium" | "high";
  publishedAt: string;
  why: string;
  relationshipPath: Array<{
    fromEntityId: string;
    toEntityId: string;
    type: string;
  }>;
  provenance: BriefClaimProvenance;
}

export interface BriefWatchingSection {
  items: BriefWatchingItem[];
}

export function evidenceBackedWatchItems<T extends { signalId: string }>(
  items: T[],
  provenanceBySignal: Map<string, BriefClaimProvenance>,
  limit = 5,
): Array<{ item: T; provenance: BriefClaimProvenance }> {
  const out: Array<{ item: T; provenance: BriefClaimProvenance }> = [];
  for (const item of items) {
    const provenance = provenanceBySignal.get(item.signalId);
    if (!provenance) continue;
    out.push({ item, provenance });
    if (out.length >= limit) break;
  }
  return out;
}

export interface BriefIdeaItem {
  title: string;
  description: string;
  source: "community" | "opportunity";
  region: Region;
  evidenceUrls: BriefCitation[];
  /** subreddit name when source='community', null otherwise. */
  subreddit: string | null;
  /** ISO date when this opportunity/digest was generated. */
  surfacedAt: string;
  /** Optional decision-grade payload. Missing on legacy cached snapshots. */
  opportunity?: OpportunityBriefPayload;
}

export interface BriefTrendItem {
  title: string;
  description: string;
  subreddit: string;
  region: Region;
  evidenceUrls: BriefCitation[];
  surfacedAt: string;
}

/** Source-backed buyer/community intent attached to owner-scoped brief items. */
export interface BriefIntentItem {
  id: string;
  brandId: string;
  brandName: string;
  source: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceExcerpt: string;
  platform: string;
  intentStage:
    | "awareness"
    | "pain"
    | "comparison"
    | "purchase"
    | "proof"
    | "integration"
    | "content";
  actionType:
    | "watch"
    | "reply"
    | "create_proof"
    | "improve_docs"
    | "add_integration"
    | "write_comparison"
    | "content_opportunity";
  score: number;
  competitors: string[];
  evidenceTaskId: string | null;
  foundAt: string;
}

export interface BriefPerceptionItem {
  brandName: string;
  mentionRate: number | null;
  positiveShare: number | null;
  competitorPresence: number | null;
  latestCheckAt: string | null;
  configId: string;
  /** Highest-scoring open buyer/community finding for this brand. */
  topIntent?: BriefIntentItem;
}

export interface BriefImprovementItem {
  brandName: string;
  area: string;
  task: string;
  priority: "high" | "medium" | "low";
  /** Null for an action derived directly from intent rather than an audit. */
  auditId: string | null;
  surfacedAt: string;
  /** Original evidence URL when the task was created from a source finding. */
  sourceUrl?: string | null;
  /** Present when this action was exposed by a buyer/community finding. */
  intent?: BriefIntentItem;
}

export interface BriefSnapshot {
  generatedAt: string;
  region: Region;
  hasBrand: boolean;
  stocks: BriefStockItem[];
  ideas: BriefIdeaItem[];
  trends: BriefTrendItem[];
  /** Owner-scoped and omitted by older cached snapshots. */
  watching?: BriefWatchingSection;
  perception: BriefPerceptionItem[];
  improvements: BriefImprovementItem[];
}

export const BRIEF_PUBLIC_SECTIONS: BriefSectionKey[] = ["stocks", "ideas", "trends"];
export const BRIEF_PERSONAL_SECTIONS: BriefSectionKey[] = ["perception", "improvements"];
