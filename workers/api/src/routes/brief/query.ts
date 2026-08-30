/**
 * Daily brief D1 queries: public sections, personal sections, snapshots, feeds.
 */

import { and, asc, desc, eq, inArray, gte, isNull, sql } from 'drizzle-orm';
import {
  assessSignalQuality,
  extractBriefEditorialSummary,
  familyForSignalType,
  normalizeCommunitySummary,
  oppositeDirectionConflictIds,
  rankEvidenceUrls,
  selectBriefClaimProvenance,
  type BriefAttentionSections,
  type DiggAttentionGapItem,
  type DiggAttentionItem,
  type BriefIdeaItem,
  type BriefSnapshot,
  type BriefStockItem,
  type BriefTrendItem,
  type ClaimEvidenceLink,
  type ClaimWithEvidence,
  type OpportunityBriefPayload,
  type Region,
  type SignalFamily,
} from '@high-signal/shared';
import { db, schema } from '../../db';
import { serializeClaimEvidenceLink } from '../../lib/signal-quality';
import {
  COMMUNITY_DIGEST_LOOKBACK_DAYS,
  IDEAS_LIMIT,
  RECENT_SIGNAL_WINDOW_DAYS,
  STOCKS_LIMIT,
  TRENDS_LIMIT,
  d2cBriefItemsForRegion,
  headlineFromBody,
  isBriefStockEvidenceEligible,
  isPublicSourceLink,
  rankStocks,
  resolveHitRate,
  type BucketCounts,
} from './compose';

type BriefDatabase = ReturnType<typeof db>;

const DIGG_ATTENTION_WINDOW_HOURS = 36;
const DIGG_SECTION_LIMIT = 8;

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function epochIso(value: Date | number | string | null): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return new Date(value ?? 0).toISOString();
}

export async function buildDiggAttention(
  database: BriefDatabase,
  now = new Date()
): Promise<BriefAttentionSections> {
  const since = new Date(now.getTime() - DIGG_ATTENTION_WINDOW_HOURS * 60 * 60 * 1000);
  let rows: Array<{
    shortId: string;
    canonicalDiggUrl: string;
    title: string;
    summary: string | null;
    firstSeenAt: Date;
    retrievedAt: Date;
    position: number | null;
    positionDelta: number | null;
    peakPosition: number | null;
    entryStatus: string | null;
    badges: unknown;
    distinctAccountCount: number;
    sourceUrls: unknown;
    rawPayload: unknown;
    signalSlug: string | null;
    entityName: string | null;
    matchBasis: 'evidence_url' | 'entity' | null;
    matchConfidence: number | null;
  }> = [];
  try {
    rows = await database
      .select({
        shortId: schema.diggClusters.shortId,
        canonicalDiggUrl: schema.diggClusters.canonicalDiggUrl,
        title: schema.diggClusters.title,
        summary: schema.diggClusters.diggSummary,
        firstSeenAt: schema.diggClusters.firstSeenAt,
        retrievedAt: schema.diggClusters.retrievedAt,
        position: schema.diggClusters.position,
        positionDelta: schema.diggClusters.positionDelta,
        peakPosition: schema.diggClusters.peakPosition,
        entryStatus: schema.diggClusters.entryStatus,
        badges: schema.diggClusters.badges,
        distinctAccountCount: schema.diggClusters.distinctAccountCount,
        sourceUrls: schema.diggClusters.sourceUrls,
        rawPayload: schema.diggClusters.rawPayload,
        signalSlug: schema.signals.slug,
        entityName: schema.entities.name,
        matchBasis: schema.diggSignalLinks.matchBasis,
        matchConfidence: schema.diggSignalLinks.matchConfidence,
      })
      .from(schema.diggClusters)
      .leftJoin(
        schema.diggSignalLinks,
        eq(schema.diggSignalLinks.shortId, schema.diggClusters.shortId)
      )
      .leftJoin(
        schema.signals,
        and(
          eq(schema.signals.id, schema.diggSignalLinks.signalId),
          eq(schema.signals.reviewStatus, 'published')
        )
      )
      .leftJoin(schema.entities, eq(schema.entities.id, schema.diggClusters.primaryEntityId))
      .where(gte(schema.diggClusters.retrievedAt, since))
      .orderBy(asc(schema.diggClusters.position), desc(schema.diggClusters.positionDelta))
      .limit(160);
  } catch {
    return { attentionLeaders: [], emergingBeforeMainstream: [], attentionEvidenceGaps: [] };
  }

  const byShortId = new Map<string, DiggAttentionItem>();
  for (const row of rows) {
    const raw = jsonValue<Record<string, unknown>>(row.rawPayload, {});
    const engagement = jsonValue<Record<string, unknown>>(raw['engagement_sources'], {});
    const canonicalSourceCount = Math.max(
      0,
      Number(engagement['canonical_source_count'] ?? 0) || 0
    );
    const firstSeenMs = new Date(epochIso(row.firstSeenAt)).getTime();
    const retrievedMs = new Date(epochIso(row.retrievedAt)).getTime();
    const existing = byShortId.get(row.shortId);
    const candidate: DiggAttentionItem = {
      shortId: row.shortId,
      canonicalDiggUrl: row.canonicalDiggUrl,
      title: row.title,
      summary: row.summary,
      firstSeenAt: epochIso(row.firstSeenAt),
      retrievedAt: epochIso(row.retrievedAt),
      position: row.position,
      positionDelta: row.positionDelta,
      peakPosition: row.peakPosition,
      entryStatus: row.entryStatus,
      badges: jsonValue<unknown[]>(row.badges, []).filter(
        (badge): badge is string => typeof badge === 'string'
      ),
      distinctAccountCount: row.distinctAccountCount,
      attentionDurationHours: Math.max(
        0,
        Math.round(((retrievedMs - firstSeenMs) / 3_600_000) * 10) / 10
      ),
      canonicalSourceCount,
      sourceUrls: jsonValue<unknown[]>(row.sourceUrls, []).filter(
        (url): url is string => typeof url === 'string'
      ),
      signalSlug: row.signalSlug,
      entityName: row.entityName,
      matchBasis: row.signalSlug ? row.matchBasis : null,
      matchConfidence: row.signalSlug ? row.matchConfidence : null,
      attentionState: row.signalSlug ? 'matched_signal' : 'investigation_lead',
      sourceClass: 'attention_aggregator',
      evidenceTier: 'derived',
      confidenceContribution: 'none',
    };
    if (!existing || (!existing.signalSlug && candidate.signalSlug))
      byShortId.set(row.shortId, candidate);
  }

  const items = Array.from(byShortId.values());
  const rank = (item: DiggAttentionItem) => item.position ?? 10_000;
  const attentionLeaders = items
    .filter((item) => item.signalSlug && (item.position != null || item.distinctAccountCount >= 3))
    .sort((a, b) => rank(a) - rank(b) || (b.positionDelta ?? 0) - (a.positionDelta ?? 0))
    .slice(0, DIGG_SECTION_LIMIT);
  const emergingBeforeMainstream = items
    .filter(
      (item) =>
        !item.signalSlug &&
        (item.entryStatus === 'rising' ||
          item.entryStatus === 'new' ||
          item.badges.some((badge) => /rising|new|breakout/i.test(badge)) ||
          (item.positionDelta ?? 0) > 0) &&
        item.distinctAccountCount >= 2
    )
    .sort((a, b) => rank(a) - rank(b) || b.distinctAccountCount - a.distinctAccountCount)
    .slice(0, DIGG_SECTION_LIMIT);

  const attentionEvidenceGaps: DiggAttentionGapItem[] = [];
  for (const item of items) {
    const highAttention =
      (item.position != null && item.position <= 20) || item.distinctAccountCount >= 3;
    if (!item.signalSlug && highAttention) {
      attentionEvidenceGaps.push({
        id: `${item.shortId}:attention`,
        gapType: 'attention_stronger_than_evidence',
        title: item.title,
        explanation:
          'Public attention is material, but High Signal has not linked this cluster to independently supported evidence yet.',
        signalSlug: null,
        canonicalDiggUrl: item.canonicalDiggUrl,
        position: item.position,
        distinctAccountCount: item.distinctAccountCount,
        canonicalSourceCount: item.canonicalSourceCount,
        evidenceUrls: [],
      });
    }
    if (item.distinctAccountCount >= 3 && item.canonicalSourceCount === 1) {
      attentionEvidenceGaps.push({
        id: `${item.shortId}:origin`,
        gapType: 'single_origin_amplification',
        title: item.title,
        explanation:
          'Several voices are amplifying this cluster, but Digg reports only one canonical source origin.',
        signalSlug: item.signalSlug,
        canonicalDiggUrl: item.canonicalDiggUrl,
        position: item.position,
        distinctAccountCount: item.distinctAccountCount,
        canonicalSourceCount: 1,
        evidenceUrls: [],
      });
    }
    if (attentionEvidenceGaps.length >= DIGG_SECTION_LIMIT) break;
  }

  if (attentionEvidenceGaps.length < DIGG_SECTION_LIMIT) {
    const evidenceAhead = await database
      .select({
        id: schema.signals.id,
        slug: schema.signals.slug,
        bodyMd: schema.signals.bodyMd,
        entityName: schema.entities.name,
        evidenceUrls: schema.signals.evidenceUrls,
      })
      .from(schema.signals)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.signals.primaryEntityId))
      .leftJoin(schema.diggSignalLinks, eq(schema.diggSignalLinks.signalId, schema.signals.id))
      .where(
        and(
          eq(schema.signals.reviewStatus, 'published'),
          eq(schema.signals.confidence, 'high'),
          gte(schema.signals.publishedAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
          isNull(schema.diggSignalLinks.shortId)
        )
      )
      .orderBy(desc(schema.signals.publishedAt))
      .limit(DIGG_SECTION_LIMIT - attentionEvidenceGaps.length);
    for (const signal of evidenceAhead) {
      const urls = jsonValue<unknown[]>(signal.evidenceUrls, []).filter(
        (url): url is string => typeof url === 'string'
      );
      if (urls.length < 2) continue;
      attentionEvidenceGaps.push({
        id: `${signal.id}:evidence`,
        gapType: 'evidence_stronger_than_attention',
        title: headlineFromBody(signal.bodyMd, signal.entityName),
        explanation:
          'This high-confidence signal has independent evidence, but no corresponding Digg attention cluster was observed.',
        signalSlug: signal.slug,
        canonicalDiggUrl: null,
        position: null,
        distinctAccountCount: 0,
        canonicalSourceCount: 0,
        evidenceUrls: urls.slice(0, 2).map((url) => ({ url })),
      });
    }
  }

  return { attentionLeaders, emergingBeforeMainstream, attentionEvidenceGaps };
}

export async function buildStocks(
  database: BriefDatabase,
  countries: string[]
): Promise<BriefStockItem[]> {
  const sinceMs = Date.now() - RECENT_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceDate = new Date(sinceMs);

  const allRows = await database
    .select({
      signalId: schema.signals.id,
      slug: schema.signals.slug,
      signalType: schema.signals.signalType,
      direction: schema.signals.direction,
      confidence: schema.signals.confidence,
      predictedWindowDays: schema.signals.predictedWindowDays,
      publishedAt: schema.signals.publishedAt,
      bodyMd: schema.signals.bodyMd,
      evidenceList: schema.signals.evidenceUrls,
      entityId: schema.entities.id,
      entityName: schema.entities.name,
      ticker: schema.entities.ticker,
      country: schema.entities.country,
    })
    .from(schema.signals)
    .innerJoin(schema.entities, eq(schema.entities.id, schema.signals.primaryEntityId))
    .where(
      and(
        eq(schema.signals.reviewStatus, 'published'),
        gte(schema.signals.publishedAt, sinceDate),
        ...(countries.length
          ? [
              inArray(
                sql<string>`upper(${schema.entities.country})`,
                countries.map((c) => c.toUpperCase())
              ),
            ]
          : [])
      )
    )
    .orderBy(desc(schema.signals.publishedAt))
    .limit(STOCKS_LIMIT * 4); // overfetch so the post-filter can rank by direction

  // Defend the public brief from legacy rows that predate cite-or-kill: require
  // two unique citations and never surface prediction-market-only evidence.
  // Overfetch above absorbs the drop.
  const conflicts = oppositeDirectionConflictIds(
    allRows.map((row) => ({
      id: row.signalId,
      primaryEntityId: row.entityId,
      signalType: row.signalType,
      direction: row.direction,
      publishedAt: row.publishedAt,
    }))
  );
  const rows = allRows.filter(
    (row) =>
      !conflicts.has(row.signalId) &&
      isBriefStockEvidenceEligible(
        (Array.isArray(row.evidenceList) ? row.evidenceList : []).map(String)
      )
  );

  const provenanceBySignal = await loadBriefProvenanceBySignalId(
    database,
    rows.map((row) => row.signalId)
  );

  // Pull hit-rate stats — both per-type and per-family — so the renderer can
  // fall back gracefully when a fresh signal type has no scored predictions.
  const signalTypes = Array.from(new Set(rows.map((r) => r.signalType)));
  const { byType: hitRateBySignalType, byFamily: hitRateByFamily } = await loadHitRateStats(
    database,
    signalTypes
  );

  // Rank proof strength first. Direction is presentation metadata, not quality.
  const ranked = rankStocks(
    rows.map((r) => ({
      ...r,
      direction: r.direction as 'up' | 'down' | 'neutral',
      confidence: r.confidence as 'low' | 'medium' | 'high',
      verifiedOriginCount: provenanceBySignal.get(r.signalId)?.independentOriginCount ?? 0,
      qualityScore: assessSignalQuality({
        signalType: r.signalType,
        primaryEntityId: r.entityId,
        confidence: r.confidence as 'low' | 'medium' | 'high',
        evidenceUrls: (Array.isArray(r.evidenceList) ? r.evidenceList : []).map(String),
        bodyMd: r.bodyMd,
        direction: r.direction,
        publishedAt: r.publishedAt,
      }).score,
    }))
  );

  return ranked
    .flatMap((row): BriefStockItem[] => {
      const headline = headlineFromBody(row.bodyMd, row.entityName);
      const resolved = resolveHitRate(row.signalType, hitRateBySignalType, hitRateByFamily);
      const provenance = provenanceBySignal.get(row.signalId);
      const editorial = extractBriefEditorialSummary(row.bodyMd);
      if (!provenance || !editorial) return [];
      const evidenceUrls = rankEvidenceUrls(provenance.evidenceUrls, {
        entityName: row.entityName,
        ticker: row.ticker,
      });
      if (!isBriefStockEvidenceEligible(evidenceUrls)) return [];
      return [
        {
          entityId: row.entityId,
          entityName: row.entityName,
          ticker: row.ticker,
          country: row.country,
          signalType: row.signalType,
          signalFamily: familyForSignalType(row.signalType),
          direction: row.direction as 'up' | 'down' | 'neutral',
          confidence: row.confidence as 'low' | 'medium' | 'high',
          predictedWindowDays: row.predictedWindowDays,
          headline,
          signalSlug: row.slug,
          publishedAt:
            row.publishedAt instanceof Date
              ? row.publishedAt.toISOString()
              : new Date(Number(row.publishedAt)).toISOString(),
          // Brief citations come from the claim's supporting roles only; context
          // remains available on the full signal page.
          evidenceUrls: evidenceUrls.map((url) => ({ url })),
          hitRate: resolved.hitRate,
          hitRateSample: resolved.sample,
          hitRateBand: resolved.band,
          ...editorial,
          provenance,
        },
      ];
    })
    .slice(0, STOCKS_LIMIT);
}

async function loadBriefProvenanceBySignalId(
  database: BriefDatabase,
  signalIds: string[]
): Promise<Map<string, NonNullable<BriefStockItem['provenance']>>> {
  const uniqueIds = Array.from(new Set(signalIds));
  if (uniqueIds.length === 0) return new Map();
  const claimRows = await database
    .select()
    .from(schema.claimRecords)
    .where(
      and(
        inArray(schema.claimRecords.signalId, uniqueIds),
        eq(schema.claimRecords.surface, 'signal')
      )
    )
    .orderBy(desc(schema.claimRecords.createdAt));
  if (claimRows.length === 0) return new Map();
  const claimIds = claimRows.map((claim) => claim.id);
  const linkRows = await database
    .select()
    .from(schema.claimEvidenceLinks)
    .where(inArray(schema.claimEvidenceLinks.claimId, claimIds));
  const linksByClaim = new Map<string, ClaimEvidenceLink[]>();
  for (const link of linkRows) {
    const links = linksByClaim.get(link.claimId) ?? [];
    links.push(serializeClaimEvidenceLink(link));
    linksByClaim.set(link.claimId, links);
  }
  const claimsBySignal = new Map<string, ClaimWithEvidence[]>();
  for (const claim of claimRows) {
    if (!claim.signalId) continue;
    const claims = claimsBySignal.get(claim.signalId) ?? [];
    claims.push({
      id: claim.id,
      signalId: claim.signalId,
      briefItemId: claim.briefItemId ?? null,
      agentEvalResponseId: claim.agentEvalResponseId ?? null,
      surface: claim.surface,
      assertion: claim.assertion,
      confidenceBand: claim.confidenceBand,
      reviewStatus: claim.reviewStatus,
      publishReason: claim.publishReason ?? null,
      parentClaimId: claim.parentClaimId ?? null,
      version: claim.version,
      createdAt: claim.createdAt.toISOString(),
      publishedAt: claim.publishedAt?.toISOString() ?? null,
      correctedAt: claim.correctedAt?.toISOString() ?? null,
      claimEntityId: claim.claimEntityId ?? null,
      claimEvent: claim.claimEvent ?? null,
      claimAmount: claim.claimAmount ?? null,
      claimDate: claim.claimDate ?? null,
      claimDirection: claim.claimDirection ?? null,
      claimTupleKey: claim.claimTupleKey ?? null,
      evidence: linksByClaim.get(claim.id) ?? [],
    });
    claimsBySignal.set(claim.signalId, claims);
  }
  const out = new Map<string, NonNullable<BriefStockItem['provenance']>>();
  for (const [signalId, claims] of claimsBySignal) {
    const provenance = selectBriefClaimProvenance(claims);
    if (provenance) out.set(signalId, provenance);
  }
  return out;
}

async function loadHitRateStats(
  database: BriefDatabase,
  signalTypesNeeded: string[]
): Promise<{
  byType: Map<string, BucketCounts>;
  byFamily: Map<SignalFamily, BucketCounts>;
}> {
  // Load the FULL scored ledger (not just the signal types in this render).
  // Family rollup needs to see siblings, not just the requested types. The
  // ledger is small (low thousands at most), so the wide scan is fine.
  const rows = await database
    .select({
      signalType: schema.signals.signalType,
      outcome: schema.scoreRuns.outcome,
      count: sql<number>`count(*)`,
    })
    .from(schema.scoreRuns)
    .innerJoin(schema.signals, eq(schema.signals.id, schema.scoreRuns.signalId))
    // d1-scan: reviewed-unbounded issue=#145 reason=all-time scored ledger is required and remains low-volume
    .groupBy(schema.signals.signalType, schema.scoreRuns.outcome);

  const byType = new Map<string, BucketCounts>();
  for (const r of rows) {
    const bucket = byType.get(r.signalType) ?? { hit: 0, miss: 0, push: 0 };
    if (r.outcome === 'hit') bucket.hit += Number(r.count);
    else if (r.outcome === 'miss') bucket.miss += Number(r.count);
    else if (r.outcome === 'push') bucket.push += Number(r.count);
    byType.set(r.signalType, bucket);
  }

  const byFamily = new Map<SignalFamily, BucketCounts>();
  for (const [signalType, bucket] of byType) {
    const family = familyForSignalType(signalType);
    const acc = byFamily.get(family) ?? { hit: 0, miss: 0, push: 0 };
    acc.hit += bucket.hit;
    acc.miss += bucket.miss;
    acc.push += bucket.push;
    byFamily.set(family, acc);
  }

  // signalTypesNeeded is currently unused but kept on the signature so we
  // can switch to a narrowed scan if the ledger grows huge.
  void signalTypesNeeded;

  return { byType, byFamily };
}

export async function buildIdeas(
  database: BriefDatabase,
  region: Region,
  countries: string[]
): Promise<BriefIdeaItem[]> {
  // India D2C Opportunity Pipeline (plan 0013). Prepend up to 3 briefs for
  // south-asia and 1 rotating brief for global, ahead of community digests.
  // Real D1 community ideas still fill the remaining slots up to IDEAS_LIMIT.
  const d2cItems = d2cBriefItemsForRegion(region)
    .filter((item) => item.evidenceUrls.some((evidence) => isPublicSourceLink(evidence.url)))
    .map((item) => ({
      ...item,
      whyNow: item.opportunity?.marketTimingReasons[0] ?? item.description,
    }));

  const sinceMs = Date.now() - COMMUNITY_DIGEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  // Source A: community digests' key_action items across public digests.
  const digestRows = await database
    .select({
      id: schema.communityDigestSnapshots.id,
      subreddit: schema.communityDigestSnapshots.subreddit,
      snapshotDate: schema.communityDigestSnapshots.snapshotDate,
      summary: schema.communityDigestSnapshots.summary,
      summaryText: schema.communityDigestSnapshots.summaryText,
    })
    .from(schema.communityDigestSnapshots)
    .innerJoin(
      schema.trackedCommunities,
      eq(schema.trackedCommunities.id, schema.communityDigestSnapshots.trackedCommunityId)
    )
    .where(
      and(
        eq(schema.trackedCommunities.isPublic, true),
        gte(schema.communityDigestSnapshots.snapshotDate, new Date(sinceMs))
      )
    )
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(60);

  const ideas: BriefIdeaItem[] = [...d2cItems];
  for (const digest of digestRows) {
    const summary = normalizeCommunitySummary(digest.summary);
    const action = summary?.keyAction;
    if (!action || !isPublicSourceLink(action.link)) continue;
    const evidenceUrl = action.link.trim();
    ideas.push({
      title: action.title,
      description: action.desc || digest.summaryText.slice(0, 240),
      whyNow: action.desc || digest.summaryText.slice(0, 240),
      source: 'community',
      region,
      subreddit: digest.subreddit,
      surfacedAt: (digest.snapshotDate instanceof Date
        ? digest.snapshotDate
        : new Date(digest.snapshotDate as unknown as string)
      ).toISOString(),
      evidenceUrls: [{ url: evidenceUrl }],
      opportunity: communityActionToOpportunity({
        title: action.title,
        description: action.desc || digest.summaryText.slice(0, 240),
        region,
        subreddit: digest.subreddit,
        evidenceCount: 1,
      }),
    });
    if (ideas.length >= IDEAS_LIMIT) break;
  }

  // Hint to the caller — countries are unused for ideas at present (digests
  // don't carry a region tag yet); accept the param for future tightening.
  void countries;

  return ideas;
}

function communityActionToOpportunity(input: {
  title: string;
  description: string;
  region: Region;
  subreddit: string;
  evidenceCount: number;
}): OpportunityBriefPayload {
  const hasEvidence = input.evidenceCount > 0;
  return {
    verdict: hasEvidence ? 'test' : 'watch',
    confidence: 'low',
    targetUser: inferDigestTargetUser(`${input.title} ${input.description}`),
    problem: input.description || input.title,
    marketTimingReasons: [
      `r/${input.subreddit} surfaced this as a current key action in the community digest.`,
      input.region === 'global'
        ? 'Treat the first validation pass as ICP-specific before assuming broad demand.'
        : `The brief is scoped to ${input.region}, so interviews should start with that region's buyers.`,
    ],
    evidenceMix: [
      {
        kind: 'demand',
        label: 'community demand',
        summary: hasEvidence
          ? 'The digest included a cited source thread for the demand signal.'
          : 'The digest surfaced demand, but no source link was attached.',
        strength: 'low',
        sourceCount: input.evidenceCount,
      },
    ],
    competitorNotes: [
      'Competitor density is not extracted from this digest yet; validate substitutes manually.',
    ],
    pricingNotes: [
      'Price sensitivity is unknown; test willingness to pay before treating this as an entry call.',
    ],
    agentVisibilityNotes: [
      'Run an agent-answer snapshot for this category to see whether recommendations are generic, incumbent-led, or empty.',
    ],
    risks: [
      'Community demand can overstate urgency; confirm repeated pain outside the source thread.',
    ],
    nextValidationStep:
      'Turn the complaint into one landing page promise and interview 10 users from the source community.',
    priorHitRate: null,
  };
}

function inferDigestTargetUser(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.includes('founder')) return 'founders evaluating a new category';
  if (
    normalized.includes('dev') ||
    normalized.includes('code') ||
    normalized.includes('engineer')
  ) {
    return 'technical operators with repeated workflow friction';
  }
  if (normalized.includes('smb') || normalized.includes('business')) {
    return 'SMB operators trying to remove manual work';
  }
  if (normalized.includes('invest')) return 'retail investors comparing fragmented options';
  return 'users actively describing an unmet job';
}

export async function buildTrends(
  database: BriefDatabase,
  region: Region,
  countries: string[]
): Promise<BriefTrendItem[]> {
  const sinceMs = Date.now() - COMMUNITY_DIGEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const digestRows = await database
    .select({
      id: schema.communityDigestSnapshots.id,
      subreddit: schema.communityDigestSnapshots.subreddit,
      snapshotDate: schema.communityDigestSnapshots.snapshotDate,
      summary: schema.communityDigestSnapshots.summary,
      summaryText: schema.communityDigestSnapshots.summaryText,
    })
    .from(schema.communityDigestSnapshots)
    .innerJoin(
      schema.trackedCommunities,
      eq(schema.trackedCommunities.id, schema.communityDigestSnapshots.trackedCommunityId)
    )
    .where(
      and(
        eq(schema.trackedCommunities.isPublic, true),
        gte(schema.communityDigestSnapshots.snapshotDate, new Date(sinceMs))
      )
    )
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(40);

  const trends: BriefTrendItem[] = [];
  const seenSubs = new Set<string>();
  for (const digest of digestRows) {
    if (seenSubs.has(digest.subreddit)) continue; // one trend per subreddit per brief
    const summary = normalizeCommunitySummary(digest.summary);
    const trend = summary?.keyTrend;
    if (!trend || !isPublicSourceLink(trend.link)) continue;
    const evidenceUrl = trend.link.trim();
    trends.push({
      title: trend.title,
      description: trend.desc || digest.summaryText.slice(0, 240),
      whyNow: trend.desc || digest.summaryText.slice(0, 240),
      subreddit: digest.subreddit,
      region,
      evidenceUrls: [{ url: evidenceUrl }],
      surfacedAt: (digest.snapshotDate instanceof Date
        ? digest.snapshotDate
        : new Date(digest.snapshotDate as unknown as string)
      ).toISOString(),
    });
    seenSubs.add(digest.subreddit);
    if (trends.length >= TRENDS_LIMIT) break;
  }
  void countries;
  return trends;
}

/**
 * Try to read a precomputed brief snapshot from D1. Returns null if the
 * snapshot doesn't exist (before cron runs, fresh deploy, etc.) so the
 * caller falls back to the live query path.
 */
export async function tryGetPrecomputedSnapshot(
  database: BriefDatabase,
  date: string,
  region: Region
): Promise<BriefSnapshot | null> {
  try {
    const rows = await database
      .select({ briefJson: schema.dailyBriefSnapshots.briefJson })
      .from(schema.dailyBriefSnapshots)
      .where(
        and(
          eq(schema.dailyBriefSnapshots.date, date),
          eq(schema.dailyBriefSnapshots.region, region)
        )
      )
      .limit(1);
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].briefJson) as BriefSnapshot;
  } catch {
    // Table might not exist yet (pre-migration) — silently fall back.
    return null;
  }
}
