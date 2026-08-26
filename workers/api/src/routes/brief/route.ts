/**
 * Daily Brief route. The single composed surface for High Signal.
 *
 * GET /brief/daily?region=<region>&product=<seedProductId>
 *
 * - Three public sections (stocks / ideas / trends) compose without a user.
 * - Perception / improvements are seed-only demo content driven by `product`.
 * - Everything filters by region when one is supplied; "global" or absent
 *   means no country filter.
 *
 * There is no per-user variant. Every response is anonymous and cacheable.
 *
 * Hit-rate per stock signal type is computed from `score_runs` joined to
 * `signals` and inlined into each stock item.
 */

import { Hono, type Context } from 'hono';
import { desc, sql } from 'drizzle-orm';
import {
  buildBriefEditionReceipt,
  countriesForRegion,
  isProtectedHistoryDay,
  isRegion,
  istDay,
  pruneUnpublishableBriefItems,
  summarizeBriefDiscovery,
  type BriefCategoryStates,
  type BriefImprovementItem,
  type BriefPerceptionItem,
  type BriefSnapshot,
  type Region,
} from '@high-signal/shared';
import { db, schema } from '../../db';
import { renderFromSeed, safeCategory } from './compose';
import {
  buildDiggAttention,
  buildIdeas,
  buildStocks,
  buildTrends,
  tryGetPrecomputedSnapshot,
} from './query';
import { bearerGrant, verifyHistoryGrant } from '../../lib/history-access';

type Env = { DB: D1Database; BRIEF_CACHE?: KVNamespace; TURNSTILE_SECRET?: string };

// Precomputed snapshot regions — the cron precomputes these so the API
// does a single D1 lookup instead of 5-14 sequential queries.
const PRECOMPUTED_REGIONS: Region[] = [
  'global',
  'north-america',
  'europe',
  'south-asia',
  'east-asia',
];

export const briefRoute = new Hono<{ Bindings: Env }>();

briefRoute.get('/daily', async (c) => handleDailyBriefRequest(c));

async function handleDailyBriefRequest(c: Context<{ Bindings: Env }>) {
  const request = parseDailyBriefRequest(c);
  const protectedHistory = Boolean(
    request.archiveDate && isProtectedHistoryDay(request.archiveDate)
  );
  if (
    protectedHistory &&
    !(await verifyHistoryGrant(bearerGrant(c.req.header('authorization')), c.env.TURNSTILE_SECRET))
  ) {
    c.header('Cache-Control', 'private, no-store');
    return c.json({ error: 'history_verification_required' }, 403);
  }
  if (protectedHistory) c.header('Cache-Control', 'private, no-store');
  const database = db(c.env.DB);

  const cached = await cachedDailyBrief(database, request);
  if (cached) return c.json(cached.body, cached.status);

  const snapshot = await composeDailyBrief(database, request);
  return c.json(snapshot);
}

export function parseDailyBriefRequest(c: Context<{ Bindings: Env }>) {
  const rawRegion = c.req.query('region')?.toLowerCase().trim() ?? 'global';
  const dateParam = c.req.query('date')?.trim() ?? '';
  return {
    region: (isRegion(rawRegion) ? rawRegion : 'global') as Region,
    productId: c.req.query('product')?.trim() ?? '',
    archiveDate: /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null,
  };
}

async function cachedDailyBrief(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>
) {
  const lookupDate = request.archiveDate ?? istDay();
  const snapshot = await tryGetPrecomputedSnapshot(database, lookupDate, request.region);
  if (snapshot && (request.archiveDate || buildBriefEditionReceipt(snapshot).publishable)) {
    return { body: snapshot, status: 200 as const };
  }
  if (request.archiveDate) {
    return {
      body: { error: 'no_brief_for_date', date: request.archiveDate, region: request.region },
      status: 404 as const,
    };
  }
  return null;
}

async function composeDailyBrief(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>
) {
  const countries = countriesForRegion(request.region);
  const [stockResult, ideaResult, trendResult, attention] = await Promise.all([
    safeCategory(() => buildStocks(database, countries), 'stocks'),
    safeCategory(() => buildIdeas(database, request.region, countries), 'ideas'),
    safeCategory(() => buildTrends(database, request.region, countries), 'trends'),
    buildDiggAttention(database),
  ]);

  const brand = loadDailyBriefBrand(request);
  return {
    generatedAt: new Date().toISOString(),
    region: request.region,
    hasBrand: brand.hasBrand,
    stocks: stockResult.items,
    ideas: ideaResult.items,
    trends: trendResult.items,
    perception: brand.perception,
    improvements: brand.improvements,
    ...attention,
    categoryStates: {
      stocks: stockResult.state,
      ideas: ideaResult.state,
      trends: trendResult.state,
    },
  } satisfies BriefSnapshot;
}

/**
 * Perception and improvements are seed-only. They used to be composed from a
 * signed-in owner's connected brand (mention configs + agent-eval audits), but
 * per-user data was removed when the product went fully public; the `?product=`
 * seed picker is all that remains.
 */
function loadDailyBriefBrand(request: ReturnType<typeof parseDailyBriefRequest>) {
  let perception: BriefPerceptionItem[] = [];
  let improvements: BriefImprovementItem[] = [];
  let hasBrand = false;

  if (request.productId) {
    const seeded = renderFromSeed(request.productId);
    if (seeded) {
      perception = seeded.perception;
      improvements = seeded.improvements;
      hasBrand = true;
    }
  }

  return { perception, improvements, hasBrand };
}

/**
 * Precompute brief snapshots for all configured regions. Called by the
 * scheduled cron handler. Each region's public sections (stocks, ideas,
 * trends) are computed once and stored as JSON. The API then does a
 * single D1 lookup instead of 5-14 sequential queries.
 */
interface BriefPrecomputeRegionResult {
  region: Region;
  status: 'published' | 'rejected' | 'failed';
  counts?: { stocks: number; ideas: number; trends: number };
  issues?: Array<{ section: string; item: number | null; reason: string }>;
}

interface BriefPrecomputeResult {
  date: string;
  globalPublished: boolean;
  regions: BriefPrecomputeRegionResult[];
}

export async function precomputeBriefSnapshots(env: {
  DB: D1Database;
}): Promise<BriefPrecomputeResult> {
  const database = db(env.DB);
  const today = istDay();
  const nowIso = new Date().toISOString();
  const regions: BriefPrecomputeRegionResult[] = [];

  for (const region of PRECOMPUTED_REGIONS) {
    try {
      const countries = countriesForRegion(region);

      const [stockResult, ideaResult, trendResult, attention] = await Promise.all([
        safeCategory(() => buildStocks(database, countries), 'stocks'),
        safeCategory(() => buildIdeas(database, region, countries), 'ideas'),
        safeCategory(() => buildTrends(database, region, countries), 'trends'),
        buildDiggAttention(database),
      ]);
      const stocks = stockResult.items;
      const ideas = ideaResult.items;
      const trends = trendResult.items;
      const categoryStates: BriefCategoryStates = {
        stocks: stockResult.state,
        ideas: ideaResult.state,
        trends: trendResult.state,
      };

      const snapshot: BriefSnapshot = {
        generatedAt: nowIso,
        region,
        hasBrand: false,
        stocks,
        ideas,
        trends,
        perception: [],
        improvements: [],
        ...attention,
        categoryStates,
      };

      // Withhold the items that fail a per-item gate rather than letting them
      // reject the whole edition. Every gate still applies at full strength;
      // section-level failures (fixture content, unavailable category) remain
      // fatal below, so this still fails closed.
      const pruned = pruneUnpublishableBriefItems(snapshot);
      const publishedSnapshot = pruned.snapshot;
      if (pruned.withheld.length > 0) {
        console.error(
          `[brief-precompute] ${region} withheld ${pruned.withheld.length} item(s) on ${today}`,
          JSON.stringify(pruned.withheld)
        );
      }

      const receipt = buildBriefEditionReceipt(publishedSnapshot);
      if (!receipt.publishable) {
        // Loud on purpose. This path wrote no snapshot for twelve consecutive
        // days at console.warn and nobody saw it; the reader just saw an empty
        // brief. scripts/verify-daily-brief.mjs now fails CI on the same state.
        console.error(
          `[brief-precompute] ${region} REJECTED on ${today} — no snapshot written`,
          JSON.stringify({ counts: receipt.counts, issues: receipt.issues })
        );
        regions.push({
          region,
          status: 'rejected',
          counts: receipt.counts,
          issues: receipt.issues,
        });
        continue;
      }

      await database
        .insert(schema.dailyBriefSnapshots)
        .values({
          date: today,
          region,
          briefJson: JSON.stringify(publishedSnapshot),
          computedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: [schema.dailyBriefSnapshots.date, schema.dailyBriefSnapshots.region],
          set: {
            briefJson: JSON.stringify(publishedSnapshot),
            computedAt: nowIso,
          },
        });

      console.log(
        `[brief-precompute] ${region}: ${publishedSnapshot.stocks.length} stocks, ${publishedSnapshot.ideas.length} ideas, ${publishedSnapshot.trends.length} trends, ${publishedSnapshot.attentionLeaders?.length ?? 0} attention leaders, ${pruned.withheld.length} withheld; gate=pass`
      );
      regions.push({ region, status: 'published', counts: receipt.counts });
    } catch (err) {
      console.error(`[brief-precompute] ${region} failed:`, err);
      regions.push({ region, status: 'failed' });
    }
  }

  return {
    date: today,
    globalPublished: regions.some(
      (result) => result.region === 'global' && result.status === 'published'
    ),
    regions,
  };
}

/**
 * GET /brief/dates — list all dates that have at least one precomputed
 * brief snapshot. Used by the archive index page to render the list of
 * permanent /brief/<date> URLs. Returns dates descending (newest first)
 * with the count of regions available per date.
 */
briefRoute.get('/dates', async (c) => {
  const database = db(c.env.DB);
  try {
    const historyGranted = await verifyHistoryGrant(
      bearerGrant(c.req.header('authorization')),
      c.env.TURNSTILE_SECRET
    );
    if (historyGranted) c.header('Cache-Control', 'private, no-store');
    const rows = await database
      .select({
        date: schema.dailyBriefSnapshots.date,
        regionCount: sql<number>`count(${schema.dailyBriefSnapshots.region})`,
        computedAt: sql<string>`max(${schema.dailyBriefSnapshots.computedAt})`,
        globalBriefJson: sql<
          string | null
        >`max(case when ${schema.dailyBriefSnapshots.region} = 'global' then ${schema.dailyBriefSnapshots.briefJson} end)`,
      })
      .from(schema.dailyBriefSnapshots)
      .groupBy(schema.dailyBriefSnapshots.date)
      .orderBy(desc(schema.dailyBriefSnapshots.date))
      .limit(500);

    return c.json({
      dates: rows
        .filter((row) => historyGranted || !isProtectedHistoryDay(row.date))
        .map((r) => {
          let discovery = { publicItemCount: 0, citedItemCount: 0 };
          if (r.globalBriefJson) {
            try {
              discovery = summarizeBriefDiscovery(JSON.parse(r.globalBriefJson) as BriefSnapshot);
            } catch {
              // A malformed snapshot is not safe to advertise for discovery.
            }
          }
          return {
            date: r.date,
            regionCount: r.regionCount,
            computedAt: r.computedAt,
            ...discovery,
          };
        }),
    });
  } catch {
    // Table might not exist yet (pre-migration) — return empty list.
    return c.json({ dates: [] });
  }
});
