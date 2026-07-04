/**
 * Daily Brief route. The single composed surface for High Signal.
 *
 * GET /brief/daily?region=<region>&owner=<ownerId>
 *
 * - Three public sections (stocks / ideas / trends) compose without a user.
 * - Two personal sections (perception / improvements) compose only when an
 *   ownerId is supplied AND that owner has a connected brand.
 * - Everything filters by region when one is supplied; "global" or absent
 *   means no country filter.
 *
 * Hit-rate per stock signal type is computed from `score_runs` joined to
 * `signals` and inlined into each stock item.
 */

import { Hono } from "hono";
import { and, desc, eq, inArray, gte, sql } from "drizzle-orm";
import {
  countriesForRegion,
  fallbackIdeas,
  fallbackStocks,
  fallbackTrends,
  familyForSignalType,
  findSeedProduct,
  isRegion,
  normalizeCommunitySummary,
  rankEvidenceUrls,
  SEED_PRODUCTS,
  type BriefIdeaItem,
  type BriefImprovementItem,
  type BriefPerceptionItem,
  type BriefSnapshot,
  type BriefStockItem,
  type BriefTrendItem,
  type HitRateBand,
  type Region,
  type SeedProduct,
  type SignalFamily,
} from "@high-signal/shared";
import { db, schema } from "../db";

type Env = { DB: D1Database; BRIEF_CACHE?: KVNamespace };

// Precomputed snapshot regions — the cron precomputes these so the API
// does a single D1 lookup instead of 5-14 sequential queries.
const PRECOMPUTED_REGIONS: Region[] = [
  "global",
  "north-america",
  "europe",
  "south-asia",
  "east-asia",
];

export const STOCKS_LIMIT = 12;
export const IDEAS_LIMIT = 10;
export const TRENDS_LIMIT = 8;
/**
 * 4-week window. Sarthak's 2026-05-25 directive: "sync at least 4 weeks of
 * data everywhere." The brief reads from real D1 wherever it exists; seed
 * fallback only kicks in for the personal sections when nothing's available
 * for the picked product.
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
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
}
export function rankStocks<T extends RankableRow>(rows: T[]): T[] {
  const dirWeight = (d: string) => (d === "up" ? 0 : d === "down" ? 1 : 2);
  const confWeight = (c: string) => (c === "high" ? 0 : c === "medium" ? 1 : 2);
  return rows.slice().sort((a, b) => {
    const direction = dirWeight(a.direction) - dirWeight(b.direction);
    if (direction !== 0) return direction;
    return confWeight(a.confidence) - confWeight(b.confidence);
  });
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
  byFamily: Map<SignalFamily, BucketCounts>,
): { hitRate: number | null; sample: number; band: HitRateBand } {
  const direct = byType.get(signalType);
  if (direct) {
    const decided = direct.hit + direct.miss;
    if (decided >= HIT_RATE_SAMPLE_MIN) {
      return { hitRate: direct.hit / decided, sample: decided, band: "direct" };
    }
  }
  const family = familyForSignalType(signalType);
  const familyBucket = byFamily.get(family);
  if (familyBucket) {
    const decided = familyBucket.hit + familyBucket.miss;
    if (decided >= HIT_RATE_FAMILY_MIN) {
      return { hitRate: familyBucket.hit / decided, sample: decided, band: "family" };
    }
    if (decided >= 1) {
      return { hitRate: familyBucket.hit / decided, sample: decided, band: "early" };
    }
  }
  if (direct) {
    const decided = direct.hit + direct.miss;
    if (decided >= 1) {
      return { hitRate: direct.hit / decided, sample: decided, band: "early" };
    }
  }
  return { hitRate: null, sample: 0, band: "none" };
}

/** Extract a one-line headline from a signal's body markdown, falling back to entity name. */
export function headlineFromBody(bodyMd: string, fallback: string): string {
  const firstLine = (bodyMd ?? "").split("\n").find((line) => line.trim());
  if (!firstLine) return fallback;
  return firstLine.replace(/^#+\s*/, "").trim().slice(0, 180) || fallback;
}

export const briefRoute = new Hono<{ Bindings: Env }>();

briefRoute.get("/daily", async (c) => {
  const rawRegion = c.req.query("region")?.toLowerCase().trim() ?? "global";
  const region: Region = isRegion(rawRegion) ? rawRegion : "global";
  const ownerId = c.req.query("owner")?.trim() ?? "";
  const productId = c.req.query("product")?.trim() ?? "";

  const database = db(c.env.DB);

  // Fast path: try precomputed snapshot for public sections (no owner).
  // Personal sections (perception/improvements) always need live queries
  // since they depend on the specific owner.
  if (!ownerId) {
    const today = new Date().toISOString().slice(0, 10);
    const snapshot = await tryGetPrecomputedSnapshot(database, today, region);
    if (snapshot) {
      // If a product query param is supplied, overlay the seed product's
      // personal sections on top of the precomputed public sections.
      if (productId) {
        const seeded = renderFromSeed(productId);
        if (seeded) {
          snapshot.perception = seeded.perception;
          snapshot.improvements = seeded.improvements;
          snapshot.hasBrand = true;
        }
      }
      return c.json(snapshot);
    }
  }

  const countries = countriesForRegion(region);

  // Each section is independently fault-tolerant: a missing table, empty
  // result, or driver error degrades to seed fallback rather than failing
  // the whole brief. This keeps the daily-brief surface live even on a
  // fresh deploy where D1 hasn't been migrated/seeded yet.
  let [stocks, ideas, trends] = await Promise.all([
    safe(() => buildStocks(database, countries), "stocks"),
    safe(() => buildIdeas(database, region, countries), "ideas"),
    safe(() => buildTrends(database, region, countries), "trends"),
  ]);

  if (stocks.length === 0) stocks = fallbackStocks(region, STOCKS_LIMIT);
  if (ideas.length === 0) ideas = fallbackIdeas(region, IDEAS_LIMIT);
  if (trends.length === 0) trends = fallbackTrends(region, TRENDS_LIMIT);

  let perception: BriefPerceptionItem[] = [];
  let improvements: BriefImprovementItem[] = [];
  let hasBrand = false;

  // Priority 1: a real signed-in owner with their own brand data in D1.
  if (ownerId) {
    [perception, improvements] = await Promise.all([
      safe(() => buildPerception(database, ownerId), "perception"),
      safe(() => buildImprovements(database, ownerId), "improvements"),
    ]);
    hasBrand = perception.length > 0 || improvements.length > 0;
  }

  // Priority 2: an explicit product= seed selection (no auth needed). This is
  // the public demo path Sarthak called out — 30-40 seed products users can
  // switch between to see what sections 4 + 5 look like.
  if (!hasBrand && productId) {
    const seeded = renderFromSeed(productId);
    if (seeded) {
      perception = seeded.perception;
      improvements = seeded.improvements;
      hasBrand = true;
    }
  }

  // Priority 3: no owner, no product. Pick a rotating spotlight from the seed
  // so anonymous visitors still see populated sections instead of an empty
  // hint. Hour-based rotation so the spotlight feels alive.
  if (!hasBrand) {
    const spotlight = pickSpotlight(region);
    if (spotlight) {
      const seeded = renderFromSeed(spotlight.id);
      if (seeded) {
        perception = seeded.perception;
        improvements = seeded.improvements;
        hasBrand = true;
      }
    }
  }

  const snapshot: BriefSnapshot = {
    generatedAt: new Date().toISOString(),
    region,
    hasBrand,
    stocks,
    ideas,
    trends,
    perception,
    improvements,
  };
  return c.json(snapshot);
});

export function renderFromSeed(productId: string): {
  perception: BriefPerceptionItem[];
  improvements: BriefImprovementItem[];
} | null {
  const product = findSeedProduct(productId);
  if (!product) return null;
  return seedToBrief(product);
}

export function pickSpotlight(region: Region, nowMs: number = Date.now()): SeedProduct | null {
  const pool = region === "global"
    ? SEED_PRODUCTS
    : SEED_PRODUCTS.filter((p) => p.region === region);
  if (pool.length === 0) return null;
  const hourBucket = Math.floor(nowMs / (1000 * 60 * 60));
  return pool[hourBucket % pool.length] ?? null;
}

/**
 * Run a section builder and absorb any error (missing table, transient D1
 * outage, schema drift) — the brief route falls back to seed content when a
 * builder returns an empty array.
 */
async function safe<T>(builder: () => Promise<T[]>, section: string): Promise<T[]> {
  try {
    return await builder();
  } catch (error) {
    console.warn(`[brief] ${section} builder failed; falling back to seed`, error);
    return [];
  }
}

export function seedToBrief(product: SeedProduct, nowIso: string = new Date().toISOString()): {
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

async function buildStocks(
  database: ReturnType<typeof db>,
  countries: string[],
): Promise<BriefStockItem[]> {
  const sinceMs = Date.now() - RECENT_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceDate = new Date(sinceMs);

  const rows = await database
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
        eq(schema.signals.reviewStatus, "published"),
        gte(schema.signals.publishedAt, sinceDate),
        ...(countries.length
          ? [inArray(sql<string>`upper(${schema.entities.country})`, countries.map((c) => c.toUpperCase()))]
          : []),
      ),
    )
    .orderBy(desc(schema.signals.publishedAt))
    .limit(STOCKS_LIMIT * 4); // overfetch so the post-filter can rank by direction

  // Pull hit-rate stats — both per-type and per-family — so the renderer can
  // fall back gracefully when a fresh signal type has no scored predictions.
  const signalTypes = Array.from(new Set(rows.map((r) => r.signalType)));
  const { byType: hitRateBySignalType, byFamily: hitRateByFamily } =
    await loadHitRateStats(database, signalTypes);

  // Prefer up/down over neutral and high-confidence first within a type.
  const ranked = rankStocks(
    rows.map((r) => ({
      ...r,
      direction: r.direction as "up" | "down" | "neutral",
      confidence: r.confidence as "low" | "medium" | "high",
    })),
  ).slice(0, STOCKS_LIMIT);

  return ranked.map((row): BriefStockItem => {
    const headline = headlineFromBody(row.bodyMd, row.entityName);
    const evidenceArr = Array.isArray(row.evidenceList) ? row.evidenceList : [];
    const resolved = resolveHitRate(row.signalType, hitRateBySignalType, hitRateByFamily);
    return {
      entityId: row.entityId,
      entityName: row.entityName,
      ticker: row.ticker,
      country: row.country,
      signalType: row.signalType,
      signalFamily: familyForSignalType(row.signalType),
      direction: row.direction as "up" | "down" | "neutral",
      confidence: row.confidence as "low" | "medium" | "high",
      predictedWindowDays: row.predictedWindowDays,
      headline,
      signalSlug: row.slug,
      publishedAt: row.publishedAt instanceof Date
        ? row.publishedAt.toISOString()
        : new Date(Number(row.publishedAt)).toISOString(),
      // Lead with the most authoritative, on-topic citation: downstream
      // surfaces (email caps at 2, cards truncate) must not show a weak or
      // off-entity source first. Reorders only — count is unchanged.
      evidenceUrls: rankEvidenceUrls(
        evidenceArr.map((url) => String(url)),
        { entityName: row.entityName, ticker: row.ticker },
      ).map((url) => ({ url })),
      hitRate: resolved.hitRate,
      hitRateSample: resolved.sample,
      hitRateBand: resolved.band,
    };
  });
}

async function loadHitRateStats(
  database: ReturnType<typeof db>,
  signalTypesNeeded: string[],
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
    if (r.outcome === "hit") bucket.hit += Number(r.count);
    else if (r.outcome === "miss") bucket.miss += Number(r.count);
    else if (r.outcome === "push") bucket.push += Number(r.count);
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

async function buildIdeas(
  database: ReturnType<typeof db>,
  region: Region,
  countries: string[],
): Promise<BriefIdeaItem[]> {
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
      eq(schema.trackedCommunities.id, schema.communityDigestSnapshots.trackedCommunityId),
    )
    .where(
      and(
        eq(schema.trackedCommunities.isPublic, true),
        gte(schema.communityDigestSnapshots.snapshotDate, new Date(sinceMs)),
      ),
    )
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(60);

  const ideas: BriefIdeaItem[] = [];
  for (const digest of digestRows) {
    const summary = normalizeCommunitySummary(digest.summary);
    const action = summary?.keyAction;
    if (!action) continue;
    ideas.push({
      title: action.title,
      description: action.desc || digest.summaryText.slice(0, 240),
      source: "community",
      region,
      subreddit: digest.subreddit,
      surfacedAt: (digest.snapshotDate instanceof Date
        ? digest.snapshotDate
        : new Date(digest.snapshotDate as unknown as string)).toISOString(),
      evidenceUrls: action.link ? [{ url: action.link }] : [],
    });
    if (ideas.length >= IDEAS_LIMIT) break;
  }

  // Hint to the caller — countries are unused for ideas at present (digests
  // don't carry a region tag yet); accept the param for future tightening.
  void countries;

  return ideas;
}

async function buildTrends(
  database: ReturnType<typeof db>,
  region: Region,
  countries: string[],
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
      eq(schema.trackedCommunities.id, schema.communityDigestSnapshots.trackedCommunityId),
    )
    .where(
      and(
        eq(schema.trackedCommunities.isPublic, true),
        gte(schema.communityDigestSnapshots.snapshotDate, new Date(sinceMs)),
      ),
    )
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(40);

  const trends: BriefTrendItem[] = [];
  const seenSubs = new Set<string>();
  for (const digest of digestRows) {
    if (seenSubs.has(digest.subreddit)) continue; // one trend per subreddit per brief
    const summary = normalizeCommunitySummary(digest.summary);
    const trend = summary?.keyTrend;
    if (!trend) continue;
    trends.push({
      title: trend.title,
      description: trend.desc || digest.summaryText.slice(0, 240),
      subreddit: digest.subreddit,
      region,
      evidenceUrls: trend.link ? [{ url: trend.link }] : [],
      surfacedAt: (digest.snapshotDate instanceof Date
        ? digest.snapshotDate
        : new Date(digest.snapshotDate as unknown as string)).toISOString(),
    });
    seenSubs.add(digest.subreddit);
    if (trends.length >= TRENDS_LIMIT) break;
  }
  void countries;
  return trends;
}

async function buildPerception(
  database: ReturnType<typeof db>,
  ownerId: string,
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
          and(eq(schema.mentionChecks.configId, config.id), eq(schema.mentionChecks.status, "completed")),
        )
        .orderBy(desc(schema.mentionChecks.createdAt))
        .limit(1);
      if (!latestCheck) return null;
      const results = await database
        .select()
        .from(schema.mentionResults)
        .where(eq(schema.mentionResults.checkId, latestCheck.id));
      const mentioned = results.filter((r) => r.brandMentioned);
      const positive = mentioned.filter((r) => r.brandSentiment === "positive").length;
      const competitorMentions = results.reduce((sum, r) => {
        const list = Array.isArray(r.competitorsMentioned) ? r.competitorsMentioned : [];
        return sum + list.filter((c) => c && typeof c === "object" && (c as { mentioned?: boolean }).mentioned).length;
      }, 0);
      return {
        brandName: config.brandName,
        mentionRate: latestCheck.brandMentionRate ?? (results.length ? mentioned.length / results.length : null),
        positiveShare: mentioned.length ? positive / mentioned.length : null,
        competitorPresence: results.length ? competitorMentions / results.length : null,
        latestCheckAt: (latestCheck.completedAt ?? latestCheck.createdAt)?.toISOString() ?? null,
        configId: config.id,
      };
    }),
  );
  return perConfig.filter((item): item is BriefPerceptionItem => item !== null);
}

async function buildImprovements(
  database: ReturnType<typeof db>,
  ownerId: string,
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
          eq(schema.agentEvidenceTasks.status, "open"),
        ),
      )
      .orderBy(
        sql`CASE ${schema.agentEvidenceTasks.priority}
              WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
      )
      .limit(3);
    for (const task of tasks) {
      out.push({
        brandName: audit.brandName,
        area: task.area,
        task: task.title,
        priority: task.priority as "high" | "medium" | "low",
        auditId: audit.id,
        surfacedAt: audit.createdAt.toISOString(),
      });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Precomputed snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Try to read a precomputed brief snapshot from D1. Returns null if the
 * snapshot doesn't exist (before cron runs, fresh deploy, etc.) so the
 * caller falls back to the live query path.
 */
async function tryGetPrecomputedSnapshot(
  database: ReturnType<typeof db>,
  date: string,
  region: Region,
): Promise<BriefSnapshot | null> {
  try {
    const rows = await database
      .select({ briefJson: schema.dailyBriefSnapshots.briefJson })
      .from(schema.dailyBriefSnapshots)
      .where(
        and(
          eq(schema.dailyBriefSnapshots.date, date),
          eq(schema.dailyBriefSnapshots.region, region),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].briefJson) as BriefSnapshot;
  } catch {
    // Table might not exist yet (pre-migration) — silently fall back.
    return null;
  }
}

/**
 * Precompute brief snapshots for all configured regions. Called by the
 * scheduled cron handler. Each region's public sections (stocks, ideas,
 * trends) are computed once and stored as JSON. The API then does a
 * single D1 lookup instead of 5-14 sequential queries.
 */
export async function precomputeBriefSnapshots(
  env: { DB: D1Database },
): Promise<void> {
  const database = db(env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  for (const region of PRECOMPUTED_REGIONS) {
    try {
      const countries = countriesForRegion(region);

      let [stocks, ideas, trends] = await Promise.all([
        safe(() => buildStocks(database, countries), "stocks"),
        safe(() => buildIdeas(database, region, countries), "ideas"),
        safe(() => buildTrends(database, region, countries), "trends"),
      ]);

      if (stocks.length === 0) stocks = fallbackStocks(region, STOCKS_LIMIT);
      if (ideas.length === 0) ideas = fallbackIdeas(region, IDEAS_LIMIT);
      if (trends.length === 0) trends = fallbackTrends(region, TRENDS_LIMIT);

      // Spotlight rotation for anonymous visitors (personal sections).
      const spotlight = pickSpotlight(region);
      let perception: BriefPerceptionItem[] = [];
      let improvements: BriefImprovementItem[] = [];
      let hasBrand = false;
      if (spotlight) {
        const seeded = renderFromSeed(spotlight.id);
        if (seeded) {
          perception = seeded.perception;
          improvements = seeded.improvements;
          hasBrand = true;
        }
      }

      const snapshot: BriefSnapshot = {
        generatedAt: nowIso,
        region,
        hasBrand,
        stocks,
        ideas,
        trends,
        perception,
        improvements,
      };

      await database
        .insert(schema.dailyBriefSnapshots)
        .values({
          date: today,
          region,
          briefJson: JSON.stringify(snapshot),
          computedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: [schema.dailyBriefSnapshots.date, schema.dailyBriefSnapshots.region],
          set: {
            briefJson: JSON.stringify(snapshot),
            computedAt: nowIso,
          },
        });

      console.log(`[brief-precompute] ${region}: ${stocks.length} stocks, ${ideas.length} ideas, ${trends.length} trends`);
    } catch (err) {
      console.error(`[brief-precompute] ${region} failed:`, err);
    }
  }
}
