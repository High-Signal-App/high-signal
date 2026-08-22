/**
 * Daily Brief contract. The brief has 3 public sections plus 2 personal
 * sections that appear once a brand is connected.
 *
 * Each item carries enough metadata for the renderer to show evidence inline
 * (citations + hit-rate where applicable) without a second round-trip.
 */

import type { Region } from '../primitives/region';
import type { BriefClaimProvenance } from './claim-provenance';

export type BriefSectionKey = 'stocks' | 'ideas' | 'trends' | 'perception' | 'improvements';

export interface BriefCitation {
  url: string;
  source?: string | null;
}

export type BriefPublicSectionKey = 'stocks' | 'ideas' | 'trends';
export type BriefCategoryStatus = 'ready' | 'empty' | 'unavailable';

export interface BriefCategoryState {
  status: BriefCategoryStatus;
  /** Stable, non-sensitive reason for diagnostics and honest empty-state copy. */
  reason?: string | null;
  /** New public snapshots are live-only; fixture is reserved for explicit demos/tests. */
  source?: 'live' | 'fixture';
}

export type BriefCategoryStates = Record<BriefPublicSectionKey, BriefCategoryState>;

export interface BriefEditorialSummary {
  whatChanged: string;
  whyItMatters: string;
  uncertainty: string;
}

export type OpportunityVerdict = 'enter' | 'test' | 'watch' | 'avoid';

export interface OpportunityEvidenceMixItem {
  kind: 'demand' | 'competition' | 'pricing' | 'agent-visibility' | 'momentum';
  label: string;
  summary: string;
  strength: 'low' | 'medium' | 'high';
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
  confidence: 'low' | 'medium' | 'high';
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
 * - `family`: not enough on the exact type yet; retained for historical and
 *   internal analysis, but public renderers withhold the generic percentage.
 * - `early`: a small live sample (1–2 scored calls) exists; we surface the
 *   number with an "early" qualifier so users see motion, not silence.
 * - `none`: no scored predictions anywhere in the family — render "no live
 *   calls yet" and the project gets to keep its honesty.
 */
export type HitRateBand = 'direct' | 'family' | 'early' | 'none';

export interface BriefStockItem {
  entityId: string;
  entityName: string;
  ticker: string | null;
  country: string | null;
  signalType: string;
  signalFamily: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
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
  /** Grounded editorial copy; optional only for legacy archived snapshots. */
  whatChanged?: string;
  whyItMatters?: string;
  uncertainty?: string;
  /** Optional on legacy/precomputed snapshots while claim coverage backfills. */
  provenance?: BriefClaimProvenance;
}

export interface BriefIdeaItem {
  title: string;
  description: string;
  source: 'community' | 'opportunity';
  region: Region;
  evidenceUrls: BriefCitation[];
  /** subreddit name when source='community', null otherwise. */
  subreddit: string | null;
  /** ISO date when this opportunity/digest was generated. */
  surfacedAt: string;
  /** Grounded reader-value statement; optional on legacy cached snapshots. */
  whyNow?: string;
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
  /** Grounded reader-value statement; optional on legacy cached snapshots. */
  whyNow?: string;
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
    | 'awareness'
    | 'pain'
    | 'comparison'
    | 'purchase'
    | 'proof'
    | 'integration'
    | 'content';
  actionType:
    | 'watch'
    | 'reply'
    | 'create_proof'
    | 'improve_docs'
    | 'add_integration'
    | 'write_comparison'
    | 'content_opportunity';
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
  priority: 'high' | 'medium' | 'low';
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
  perception: BriefPerceptionItem[];
  improvements: BriefImprovementItem[];
  /** Explicit composition states on new snapshots; absent on historical records. */
  categoryStates?: BriefCategoryStates;
}

export interface BriefEditionIssue {
  section: BriefPublicSectionKey | 'edition';
  item: number | null;
  reason: string;
}

export interface BriefEditionReceipt {
  publishable: boolean;
  counts: Record<BriefPublicSectionKey, number>;
  states: BriefCategoryStates;
  issues: BriefEditionIssue[];
}

const COMPLETE_SENTENCE = /[.!?][\])"']?$/;
const MALFORMED_MARKDOWN_LINK = /\]\([^)]*\][^)]*\)|\]\([^\s)]*$/;

export function isCompleteBriefText(value: unknown, minimumLength = 24): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    text.length >= minimumLength &&
    COMPLETE_SENTENCE.test(text) &&
    !MALFORMED_MARKDOWN_LINK.test(text) &&
    !/^https?:\/\//i.test(text)
  );
}

function cleanEditorialText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceList(bodyMd: string): string[] {
  const prose = bodyMd
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^[-*]\s/.test(line))
    .join(' ');
  return cleanEditorialText(prose)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => isCompleteBriefText(sentence));
}

/**
 * Reuse complete sentences already present in signal prose. This helper never
 * writes new claims: if implication or uncertainty is missing, the signal is
 * not editorially ready for a new brief snapshot.
 */
export function extractBriefEditorialSummary(bodyMd: string): BriefEditorialSummary | null {
  const sections = new Map<string, string>();
  const lines = bodyMd.split('\n');
  let heading: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^#{1,6}\s+(what changed|why it matters|uncertainty|risk(?:s)?)/i);
    if (match) {
      heading = match[1].toLowerCase();
      continue;
    }
    if (heading && line && !line.startsWith('#')) {
      sections.set(heading, `${sections.get(heading) ?? ''} ${line}`.trim());
    }
  }

  const explicitWhat = cleanEditorialText(sections.get('what changed') ?? '');
  const explicitWhy = cleanEditorialText(sections.get('why it matters') ?? '');
  const explicitRisk = cleanEditorialText(
    sections.get('uncertainty') ?? sections.get('risk') ?? sections.get('risks') ?? ''
  );
  if (
    isCompleteBriefText(explicitWhat) &&
    isCompleteBriefText(explicitWhy) &&
    isCompleteBriefText(explicitRisk)
  ) {
    return {
      whatChanged: explicitWhat,
      whyItMatters: explicitWhy,
      uncertainty: explicitRisk,
    };
  }

  const sentences = sentenceList(bodyMd);
  const whatChanged = sentences[0];
  const uncertainty = sentences.find((sentence) =>
    /\b(risks?|uncertain|depends|could reverse|could fail|may not|however|but)\b/i.test(sentence)
  );
  const whyItMatters = sentences.find(
    (sentence, index) =>
      index > 0 &&
      sentence !== uncertainty &&
      /\b(implies|means|signals?|tailwind|headwind|demand|opportunity|impact|expansion|pressure|bottleneck|adoption)\b/i.test(
        sentence
      )
  );
  if (!whatChanged || !whyItMatters || !uncertainty) return null;
  return { whatChanged, whyItMatters, uncertainty };
}

export function categoryStatesForSnapshot(
  snapshot: Pick<BriefSnapshot, 'stocks' | 'ideas' | 'trends' | 'categoryStates'>
): BriefCategoryStates {
  const existing = snapshot.categoryStates;
  if (existing) return existing;
  return {
    stocks: { status: snapshot.stocks.length > 0 ? 'ready' : 'empty', source: 'live' },
    ideas: { status: snapshot.ideas.length > 0 ? 'ready' : 'empty', source: 'live' },
    trends: { status: snapshot.trends.length > 0 ? 'ready' : 'empty', source: 'live' },
  };
}

function isUsableCitation(value: BriefCitation): boolean {
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Validate only new edition writes; historical snapshots remain readable. */
export function buildBriefEditionReceipt(snapshot: BriefSnapshot): BriefEditionReceipt {
  const states = categoryStatesForSnapshot(snapshot);
  const counts = {
    stocks: snapshot.stocks.length,
    ideas: snapshot.ideas.length,
    trends: snapshot.trends.length,
  };
  const issues: BriefEditionIssue[] = [];

  for (const section of ['stocks', 'ideas', 'trends'] as const) {
    const state = states[section];
    if (state.source === 'fixture') issues.push({ section, item: null, reason: 'fixture_content' });
    if (state.status === 'unavailable') {
      issues.push({ section, item: null, reason: state.reason || 'category_unavailable' });
    }
    if (state.status === 'ready' && counts[section] === 0) {
      issues.push({ section, item: null, reason: 'ready_category_is_empty' });
    }
    if (state.status === 'empty' && counts[section] > 0) {
      issues.push({ section, item: null, reason: 'empty_category_has_items' });
    }
  }

  snapshot.stocks.forEach((item, index) => {
    if (
      !isCompleteBriefText(item.whatChanged) ||
      !isCompleteBriefText(item.whyItMatters) ||
      !isCompleteBriefText(item.uncertainty)
    ) {
      issues.push({ section: 'stocks', item: index, reason: 'incomplete_editorial_summary' });
    }
    const supporting = item.provenance;
    if (
      !supporting ||
      supporting.primaryCount < 1 ||
      supporting.corroborationCount < 1 ||
      supporting.contradictionCount > 0
    ) {
      issues.push({ section: 'stocks', item: index, reason: 'unsupported_structured_claim' });
    }
    if (item.evidenceUrls.filter(isUsableCitation).length < 2) {
      issues.push({ section: 'stocks', item: index, reason: 'insufficient_usable_evidence' });
    }
  });

  snapshot.ideas.forEach((item, index) => {
    if (
      !isCompleteBriefText(item.description) ||
      !isCompleteBriefText(item.whyNow) ||
      !item.evidenceUrls.some(isUsableCitation)
    ) {
      issues.push({ section: 'ideas', item: index, reason: 'malformed_or_uncited_item' });
    }
  });
  snapshot.trends.forEach((item, index) => {
    if (
      !isCompleteBriefText(item.description) ||
      !isCompleteBriefText(item.whyNow) ||
      !item.evidenceUrls.some(isUsableCitation)
    ) {
      issues.push({ section: 'trends', item: index, reason: 'malformed_or_uncited_item' });
    }
  });

  if (counts.stocks + counts.ideas + counts.trends === 0) {
    issues.push({ section: 'edition', item: null, reason: 'edition_has_no_items' });
  }
  return { publishable: issues.length === 0, counts, states, issues };
}

export interface BriefWithheldItem {
  section: BriefPublicSectionKey;
  index: number;
  reasons: string[];
}

export interface BriefEditionPrune {
  snapshot: BriefSnapshot;
  withheld: BriefWithheldItem[];
}

/**
 * Drop the items an edition cannot stand behind, rather than discarding the
 * whole edition because of them.
 *
 * `buildBriefEditionReceipt` is all-or-nothing: `publishable` is
 * `issues.length === 0`, so a single uncited or unsupported item silences every
 * other item that day. Between 2026-08-11 and 2026-08-22 that turned one
 * unsatisfiable per-item rule into twelve consecutive editions that published
 * nothing and rendered as "no qualifying items" — indistinguishable, to a
 * reader, from a genuinely quiet day.
 *
 * This weakens no evidence rule. Every per-item gate still applies with the
 * same strictness; a failing item is withheld instead of published. Rules that
 * a prune cannot honestly repair — fixture content, an unavailable category —
 * stay fatal to the edition, so the caller's receipt check still fails closed.
 *
 * A category emptied by pruning records `items_withheld_by_publish_gate`, which
 * keeps "we withheld what we had" distinguishable from "we found nothing".
 */
export function pruneUnpublishableBriefItems(snapshot: BriefSnapshot): BriefEditionPrune {
  const reasonsByItem = new Map<string, string[]>();
  for (const issue of buildBriefEditionReceipt(snapshot).issues) {
    if (issue.section === 'edition' || issue.item === null) continue;
    const key = `${issue.section}:${issue.item}`;
    reasonsByItem.set(key, [...(reasonsByItem.get(key) ?? []), issue.reason]);
  }
  if (reasonsByItem.size === 0) return { snapshot, withheld: [] };

  const withheld: BriefWithheldItem[] = [];
  const keep = <T>(section: BriefPublicSectionKey, items: readonly T[]): T[] =>
    items.filter((_item, index) => {
      const reasons = reasonsByItem.get(`${section}:${index}`);
      if (!reasons) return true;
      withheld.push({ section, index, reasons });
      return false;
    });

  const stocks = keep('stocks', snapshot.stocks);
  const ideas = keep('ideas', snapshot.ideas);
  const trends = keep('trends', snapshot.trends);
  const states: BriefCategoryStates = { ...categoryStatesForSnapshot(snapshot) };

  for (const [section, kept, before] of [
    ['stocks', stocks.length, snapshot.stocks.length],
    ['ideas', ideas.length, snapshot.ideas.length],
    ['trends', trends.length, snapshot.trends.length],
  ] as const) {
    // An unavailable category is a real upstream failure; pruning cannot make
    // it honest, so leave it — and its reason — exactly as composed.
    if (kept === before || states[section].status === 'unavailable') continue;
    states[section] =
      kept > 0
        ? { ...states[section], status: 'ready' }
        : { ...states[section], status: 'empty', reason: 'items_withheld_by_publish_gate' };
  }

  return {
    snapshot: { ...snapshot, stocks, ideas, trends, categoryStates: states },
    withheld,
  };
}

export interface BriefDiscoverySummary {
  publicItemCount: number;
  citedItemCount: number;
}

interface DiscoverableBriefItem {
  evidenceUrls?: readonly unknown[];
}

interface DiscoverableBriefSections {
  stocks?: readonly DiscoverableBriefItem[];
  ideas?: readonly DiscoverableBriefItem[];
  trends?: readonly DiscoverableBriefItem[];
}

/**
 * Summarize the public brief sections for sitemap and robots eligibility.
 * Keeping this rule beside the BriefSnapshot contract prevents the API's
 * archive inventory and the web route metadata from drifting apart.
 */
export function summarizeBriefDiscovery(
  snapshot: DiscoverableBriefSections | null
): BriefDiscoverySummary {
  const publicItems = [snapshot?.stocks, snapshot?.ideas, snapshot?.trends].flatMap((section) =>
    Array.isArray(section) ? section : []
  );
  return {
    publicItemCount: publicItems.length,
    citedItemCount: publicItems.filter(
      (item) => Array.isArray(item.evidenceUrls) && item.evidenceUrls.length > 0
    ).length,
  };
}

export const BRIEF_PUBLIC_SECTIONS: BriefSectionKey[] = ['stocks', 'ideas', 'trends'];
export const BRIEF_PERSONAL_SECTIONS: BriefSectionKey[] = ['perception', 'improvements'];
