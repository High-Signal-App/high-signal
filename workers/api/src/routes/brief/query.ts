/**
 * Daily brief D1 queries: public sections, personal sections, snapshots, feeds.
 */

import { and, asc, desc, eq, inArray, gte, lte, sql } from 'drizzle-orm';
import {
  briefFeedDefinition,
  buildBriefEditionReceipt,
  composeBriefFeedEdition,
  composeImpactChain,
  evidenceBackedWatchItems,
  extractBriefEditorialSummary,
  familyForSignalType,
  normalizeCommunitySummary,
  rankEvidenceUrls,
  selectBriefClaimProvenance,
  type BriefFeedEdition,
  type BriefFeedPeriod,
  type BriefIdeaItem,
  type BriefImprovementItem,
  type BriefIntentItem,
  type BriefPerceptionItem,
  type BriefSnapshot,
  type BriefStockItem,
  type BriefTrendItem,
  type BriefWatchingItem,
  type ClaimEvidenceLink,
  type ClaimWithEvidence,
  type ComposeArgs,
  type OpportunityBriefPayload,
  type Region,
  type SignalFamily,
} from '@high-signal/shared';
import { db, schema } from '../../db';
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
  const rows = allRows.filter((row) =>
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

  // Prefer up/down over neutral and high-confidence first within a type.
  const ranked = rankStocks(
    rows.map((r) => ({
      ...r,
      direction: r.direction as 'up' | 'down' | 'neutral',
      confidence: r.confidence as 'low' | 'medium' | 'high',
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
    links.push({
      id: link.id,
      claimId: link.claimId,
      evidenceUrl: link.evidenceUrl,
      sourceDocumentId: link.sourceDocumentId ?? null,
      role: link.role,
      weight: link.weight,
      notes: link.notes ?? null,
      addedAt: link.addedAt.toISOString(),
      addedBy: link.addedBy ?? null,
    });
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

export async function buildWatching(
  database: BriefDatabase,
  ownerId: string
): Promise<BriefWatchingItem[]> {
  const [watchlist] = await database
    .select({ id: schema.watchlists.id })
    .from(schema.watchlists)
    .where(and(eq(schema.watchlists.userId, ownerId), eq(schema.watchlists.name, 'default')))
    .limit(1);
  if (!watchlist) return [];

  const watchedRows = await database
    .select()
    .from(schema.watchlistEntities)
    .where(eq(schema.watchlistEntities.watchlistId, watchlist.id));
  if (watchedRows.length === 0) return [];
  const watchedIds = watchedRows.map((row) => row.entityId);
  const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const directRows = await database
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, 'published'),
        inArray(schema.signals.primaryEntityId, watchedIds),
        gte(schema.signals.publishedAt, since)
      )
    )
    .orderBy(desc(schema.signals.publishedAt))
    .limit(100);
  const edges = await database
    .select()
    .from(schema.relationships)
    .where(inArray(schema.relationships.fromEntityId, watchedIds));
  const secondaryIds = Array.from(new Set(edges.map((edge) => edge.toEntityId)));
  const secondaryRows = secondaryIds.length
    ? await database
        .select()
        .from(schema.signals)
        .where(
          and(
            eq(schema.signals.reviewStatus, 'published'),
            inArray(schema.signals.primaryEntityId, secondaryIds),
            gte(schema.signals.publishedAt, since)
          )
        )
        .orderBy(desc(schema.signals.publishedAt))
        .limit(150)
    : [];
  const suppressions = await database
    .select()
    .from(schema.watchlistSuppressions)
    .where(eq(schema.watchlistSuppressions.watchlistId, watchlist.id));

  const horizonDays = new Map(
    watchedRows.map((row) => [
      row.entityId,
      row.horizon === 'day' ? 1 : row.horizon === 'month' ? 31 : 7,
    ])
  );
  const withinHorizon = (publishedAt: Date, watchedId: string) =>
    Date.now() - publishedAt.getTime() <= (horizonDays.get(watchedId) ?? 7) * 24 * 60 * 60 * 1000;
  const direct = directRows.filter((row) => withinHorizon(row.publishedAt, row.primaryEntityId));
  const edgeBySubject = new Map(edges.map((edge) => [edge.toEntityId, edge]));
  const secondOrder = secondaryRows.filter((row) => {
    const edge = edgeBySubject.get(row.primaryEntityId);
    return edge ? withinHorizon(row.publishedAt, edge.fromEntityId) : false;
  });
  const toSignal = (row: typeof schema.signals.$inferSelect) => ({
    id: row.id,
    slug: row.slug,
    signalType: row.signalType,
    primaryEntityId: row.primaryEntityId,
    confidence: row.confidence,
    publishedAt: row.publishedAt.toISOString(),
  });
  const composeArgs: ComposeArgs = {
    watchedEntityIds: watchedIds,
    directSignals: direct.map(toSignal),
    edges: edges.map((edge) => ({
      fromEntityId: edge.fromEntityId,
      toEntityId: edge.toEntityId,
      type: edge.type,
      weight: edge.weight ?? 1,
      verified: Boolean(edge.verified),
    })),
    secondOrderSignals: secondOrder.map(toSignal),
    suppressions: suppressions.map((rule) => ({ kind: rule.kind, value: rule.value })),
    alreadySurfacedSignalIds: new Set(),
    nowMs: Date.now(),
  };
  const composed = composeImpactChain(composeArgs).slice(0, 20);
  const provenanceBySignal = await loadBriefProvenanceBySignalId(
    database,
    composed.map((item) => item.signalId)
  );
  const eligible = evidenceBackedWatchItems(composed, provenanceBySignal, 5);
  if (eligible.length === 0) return [];

  const entityIds = Array.from(
    new Set(eligible.flatMap(({ item }) => [item.watchedEntityId, item.subjectEntityId]))
  );
  const entityRows = await database
    .select({ id: schema.entities.id, name: schema.entities.name })
    .from(schema.entities)
    .where(inArray(schema.entities.id, entityIds));
  const entityNames = new Map(entityRows.map((entity) => [entity.id, entity.name]));
  const signalById = new Map([...direct, ...secondOrder].map((signal) => [signal.id, signal]));

  return eligible.flatMap(({ item, provenance }) => {
    const signal = signalById.get(item.signalId);
    if (!signal) return [];
    return [
      {
        ...item,
        headline: headlineFromBody(
          signal.bodyMd,
          entityNames.get(item.subjectEntityId) ?? item.subjectEntityId
        ),
        watchedEntityName: entityNames.get(item.watchedEntityId) ?? item.watchedEntityId,
        subjectEntityName: entityNames.get(item.subjectEntityId) ?? item.subjectEntityId,
        provenance,
      },
    ];
  });
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

export async function buildIntentBriefItems(
  database: BriefDatabase,
  ownerId: string
): Promise<BriefIntentItem[]> {
  const rows = await database
    .select({
      id: schema.intentOpportunities.id,
      brandId: schema.intentOpportunities.brandId,
      brandName: schema.mentionBrandConfigs.brandName,
      source: schema.intentOpportunities.source,
      sourceUrl: schema.intentOpportunities.sourceUrl,
      sourceTitle: schema.intentOpportunities.sourceTitle,
      sourceExcerpt: schema.intentOpportunities.sourceExcerpt,
      platform: schema.intentOpportunities.platform,
      intentStage: schema.intentOpportunities.intentStage,
      actionType: schema.intentOpportunities.actionType,
      score: schema.intentOpportunities.score,
      competitors: schema.intentOpportunities.competitors,
      evidenceTaskId: schema.intentOpportunities.evidenceTaskId,
      foundAt: schema.intentOpportunities.foundAt,
    })
    .from(schema.intentOpportunities)
    .innerJoin(
      schema.mentionBrandConfigs,
      eq(schema.mentionBrandConfigs.id, schema.intentOpportunities.brandId)
    )
    .where(
      and(
        eq(schema.intentOpportunities.ownerId, ownerId),
        eq(schema.mentionBrandConfigs.ownerId, ownerId),
        eq(schema.intentOpportunities.status, 'open')
      )
    )
    .orderBy(desc(schema.intentOpportunities.score), desc(schema.intentOpportunities.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    brandId: row.brandId,
    brandName: row.brandName,
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    sourceExcerpt: row.sourceExcerpt,
    platform: row.platform,
    intentStage: row.intentStage,
    actionType: row.actionType,
    score: row.score,
    competitors: Array.isArray(row.competitors)
      ? row.competitors.filter((value): value is string => typeof value === 'string')
      : [],
    evidenceTaskId: row.evidenceTaskId,
    foundAt: row.foundAt.toISOString(),
  }));
}

export async function buildPerception(
  database: BriefDatabase,
  ownerId: string
): Promise<BriefPerceptionItem[]> {
  const configs = await database
    .select()
    .from(schema.mentionBrandConfigs)
    .where(eq(schema.mentionBrandConfigs.ownerId, ownerId))
    .orderBy(desc(schema.mentionBrandConfigs.updatedAt))
    .limit(4);

  if (!configs.length) return [];

  // Each config's latestCheck → results is a real dependency (sequential
  // within a config), but the ≤4 configs are independent of each other, so we
  // fan them out concurrently and preserve input order on the way out.
  const perConfig = await Promise.all(
    configs.map(async (config): Promise<BriefPerceptionItem | null> => {
      const [latestCheck] = await database
        .select()
        .from(schema.mentionChecks)
        .where(
          and(
            eq(schema.mentionChecks.configId, config.id),
            eq(schema.mentionChecks.status, 'completed')
          )
        )
        .orderBy(desc(schema.mentionChecks.createdAt))
        .limit(1);
      if (!latestCheck) return null;
      const results = await database
        .select()
        .from(schema.mentionResults)
        .where(eq(schema.mentionResults.checkId, latestCheck.id));
      const mentioned = results.filter((r) => r.brandMentioned);
      const positive = mentioned.filter((r) => r.brandSentiment === 'positive').length;
      const competitorMentions = results.reduce((sum, r) => {
        const list = Array.isArray(r.competitorsMentioned) ? r.competitorsMentioned : [];
        return (
          sum +
          list.filter((c) => c && typeof c === 'object' && (c as { mentioned?: boolean }).mentioned)
            .length
        );
      }, 0);
      return {
        brandName: config.brandName,
        mentionRate:
          latestCheck.brandMentionRate ??
          (results.length ? mentioned.length / results.length : null),
        positiveShare: mentioned.length ? positive / mentioned.length : null,
        competitorPresence: results.length ? competitorMentions / results.length : null,
        latestCheckAt: (latestCheck.completedAt ?? latestCheck.createdAt)?.toISOString() ?? null,
        configId: config.id,
      };
    })
  );
  return perConfig.filter((item): item is BriefPerceptionItem => item !== null);
}

export async function buildImprovements(
  database: BriefDatabase,
  ownerId: string
): Promise<BriefImprovementItem[]> {
  const auditRows = await database
    .select()
    .from(schema.agentEvaluationAudits)
    .where(eq(schema.agentEvaluationAudits.ownerId, ownerId))
    .orderBy(desc(schema.agentEvaluationAudits.createdAt))
    .limit(4);
  if (!auditRows.length) return [];

  const out: BriefImprovementItem[] = [];
  for (const audit of auditRows) {
    const tasks = await database
      .select()
      .from(schema.agentEvidenceTasks)
      .where(
        and(
          eq(schema.agentEvidenceTasks.auditId, audit.id),
          eq(schema.agentEvidenceTasks.status, 'open')
        )
      )
      .orderBy(
        sql`CASE ${schema.agentEvidenceTasks.priority}
              WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`
      )
      .limit(3);
    for (const task of tasks) {
      out.push({
        brandName: audit.brandName,
        area: task.area,
        task: task.title,
        priority: task.priority as 'high' | 'medium' | 'low',
        auditId: audit.id,
        surfacedAt: audit.createdAt.toISOString(),
        sourceUrl: task.sourceUrl,
      });
      if (out.length >= 6) return out;
    }
  }
  return out;
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

interface BriefFeedSnapshotRow {
  date: string;
  briefJson: string;
  computedAt: string;
}

/**
 * Read only the accepted daily records needed by one bounded feed period.
 * Malformed or legacy snapshots that do not satisfy the current edition gate
 * remain available at their original daily URL but are not republished into a
 * new period rollup.
 */
export async function loadBriefFeedEdition(
  database: BriefDatabase,
  input: {
    feed: ReturnType<typeof briefFeedDefinition>;
    requestedCadence: string | null;
    cadence: BriefFeedEdition['cadence'];
    cadenceFellBack: boolean;
    period: BriefFeedPeriod;
    region: Region;
  }
): Promise<BriefFeedEdition> {
  let rows: BriefFeedSnapshotRow[] = [];
  try {
    rows = await database
      .select({
        date: schema.dailyBriefSnapshots.date,
        briefJson: schema.dailyBriefSnapshots.briefJson,
        computedAt: schema.dailyBriefSnapshots.computedAt,
      })
      .from(schema.dailyBriefSnapshots)
      .where(
        and(
          eq(schema.dailyBriefSnapshots.region, input.region),
          gte(schema.dailyBriefSnapshots.date, input.period.startsOn),
          lte(schema.dailyBriefSnapshots.date, input.period.endsOn)
        )
      )
      .orderBy(asc(schema.dailyBriefSnapshots.date))
      .limit(31);
  } catch {
    rows = [];
  }

  const accepted = rows.flatMap((row) => {
    try {
      const snapshot = JSON.parse(row.briefJson) as BriefSnapshot;
      return buildBriefEditionReceipt(snapshot).publishable ? [{ date: row.date, snapshot }] : [];
    } catch {
      return [];
    }
  });

  return composeBriefFeedEdition({
    ...input,
    rows: accepted,
    generatedAt: rows.at(-1)?.computedAt,
  });
}
