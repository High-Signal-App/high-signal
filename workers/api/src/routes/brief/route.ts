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

import { Hono, type Context } from 'hono';
import { desc, sql } from 'drizzle-orm';
import {
  briefFeedDefinition,
  buildBriefEditionReceipt,
  countriesForRegion,
  isBriefFeedSlug,
  isRegion,
  resolveBriefFeedPeriod,
  resolveFeedCadence,
  summarizeBriefDiscovery,
  type BriefCategoryStates,
  type BriefImprovementItem,
  type BriefPerceptionItem,
  type BriefSnapshot,
  type BriefWatchingItem,
  type Region,
} from '@high-signal/shared';
import { db, schema } from '../../db';
import {
  mergeIntentIntoImprovements,
  mergeIntentIntoPerception,
  renderFromSeed,
  safe,
  safeCategory,
} from './compose';
import {
  buildIdeas,
  buildImprovements,
  buildIntentBriefItems,
  buildPerception,
  buildStocks,
  buildTrends,
  buildWatching,
  loadBriefFeedEdition,
  tryGetPrecomputedSnapshot,
} from './query';

type Env = { DB: D1Database; BRIEF_CACHE?: KVNamespace };

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
  const database = db(c.env.DB);

  if (!request.ownerId) {
    const cached = await cachedDailyBrief(database, request);
    if (cached) return c.json(cached.body, cached.status);
  }

  const snapshot = await composeDailyBrief(database, request);
  return c.json(snapshot);
}

export function parseDailyBriefRequest(c: Context<{ Bindings: Env }>) {
  const rawRegion = c.req.query('region')?.toLowerCase().trim() ?? 'global';
  const dateParam = c.req.query('date')?.trim() ?? '';
  return {
    region: (isRegion(rawRegion) ? rawRegion : 'global') as Region,
    ownerId: c.req.query('owner')?.trim() ?? '',
    productId: c.req.query('product')?.trim() ?? '',
    archiveDate: /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null,
  };
}

async function cachedDailyBrief(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>
) {
  const lookupDate = request.archiveDate ?? new Date().toISOString().slice(0, 10);
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
  const [stockResult, ideaResult, trendResult] = await Promise.all([
    safeCategory(() => buildStocks(database, countries), 'stocks'),
    safeCategory(() => buildIdeas(database, request.region, countries), 'ideas'),
    safeCategory(() => buildTrends(database, request.region, countries), 'trends'),
  ]);

  const brand = await loadDailyBriefBrand(database, request);
  return {
    generatedAt: new Date().toISOString(),
    region: request.region,
    hasBrand: brand.hasBrand,
    stocks: stockResult.items,
    ideas: ideaResult.items,
    trends: trendResult.items,
    watching: { items: brand.watching },
    perception: brand.perception,
    improvements: brand.improvements,
    categoryStates: {
      stocks: stockResult.state,
      ideas: ideaResult.state,
      trends: trendResult.state,
    },
  } satisfies BriefSnapshot;
}

async function loadDailyBriefBrand(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>
) {
  let perception: BriefPerceptionItem[] = [];
  let improvements: BriefImprovementItem[] = [];
  let watching: BriefWatchingItem[] = [];
  let hasBrand = false;

  if (request.ownerId) {
    const [nextPerception, nextImprovements, nextWatching, intentItems] = await Promise.all([
      safe(() => buildPerception(database, request.ownerId), 'perception'),
      safe(() => buildImprovements(database, request.ownerId), 'improvements'),
      safe(() => buildWatching(database, request.ownerId), 'watching'),
      safe(() => buildIntentBriefItems(database, request.ownerId), 'intent'),
    ]);
    perception = mergeIntentIntoPerception(nextPerception, intentItems);
    improvements = mergeIntentIntoImprovements(nextImprovements, intentItems);
    watching = nextWatching;
    hasBrand = perception.length > 0 || improvements.length > 0;
  }

  if (!hasBrand && request.productId) {
    const seeded = renderFromSeed(request.productId);
    if (seeded) {
      perception = seeded.perception;
      improvements = seeded.improvements;
      hasBrand = true;
    }
  }

  return { perception, improvements, watching, hasBrand };
}

async function handleBriefFeedRequest(c: Context<{ Bindings: Env }>) {
  const feedParam = c.req.param('feed')?.trim() ?? '';
  if (!isBriefFeedSlug(feedParam)) return c.json({ error: 'unknown_brief_feed' }, 404);

  const feed = briefFeedDefinition(feedParam);
  const requestedCadence = c.req.param('cadence')?.toLowerCase().trim() || null;
  const { cadence, fellBack } = resolveFeedCadence(feed, requestedCadence);
  const rawRegion = c.req.query('region')?.toLowerCase().trim() ?? 'global';
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';
  // A period key belongs to the requested cadence. If that cadence is not
  // supported, resolve to the current edition at the feed's default cadence.
  const periodParam = fellBack ? undefined : c.req.param('period')?.trim();
  const period = resolveBriefFeedPeriod(cadence, periodParam);
  if (!period) return c.json({ error: 'invalid_brief_feed_period', cadence }, 400);

  const edition = await loadBriefFeedEdition(db(c.env.DB), {
    feed,
    requestedCadence,
    cadence,
    cadenceFellBack: fellBack,
    period,
    region,
  });
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  return c.json(edition);
}

briefRoute.get('/feeds/:feed/:cadence', handleBriefFeedRequest);
briefRoute.get('/feeds/:feed/:cadence/:period', handleBriefFeedRequest);

/**
 * Precompute brief snapshots for all configured regions. Called by the
 * scheduled cron handler. Each region's public sections (stocks, ideas,
 * trends) are computed once and stored as JSON. The API then does a
 * single D1 lookup instead of 5-14 sequential queries.
 */
export async function precomputeBriefSnapshots(env: { DB: D1Database }): Promise<void> {
  const database = db(env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  for (const region of PRECOMPUTED_REGIONS) {
    try {
      const countries = countriesForRegion(region);

      const [stockResult, ideaResult, trendResult] = await Promise.all([
        safeCategory(() => buildStocks(database, countries), 'stocks'),
        safeCategory(() => buildIdeas(database, region, countries), 'ideas'),
        safeCategory(() => buildTrends(database, region, countries), 'trends'),
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
        categoryStates,
      };

      const receipt = buildBriefEditionReceipt(snapshot);
      if (!receipt.publishable) {
        console.warn(`[brief-precompute] ${region} rejected`, JSON.stringify(receipt));
        continue;
      }

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

      console.log(
        `[brief-precompute] ${region}: ${stocks.length} stocks, ${ideas.length} ideas, ${trends.length} trends; gate=pass`
      );
    } catch (err) {
      console.error(`[brief-precompute] ${region} failed:`, err);
    }
  }
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
      dates: rows.map((r) => {
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
