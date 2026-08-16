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
  type BriefIntentItem,
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

briefRoute.get('/daily', async (c) => {
  const rawRegion = c.req.query('region')?.toLowerCase().trim() ?? 'global';
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';
  const ownerId = c.req.query('owner')?.trim() ?? '';
  const productId = c.req.query('product')?.trim() ?? '';
  // Optional date param for the permanent archive (/brief/<date>). When
  // supplied, the route serves the precomputed snapshot for that day
  // instead of today's. Format: YYYY-MM-DD. Invalid dates fall through
  // to the live path so the URL never 500s.
  const dateParam = c.req.query('date')?.trim() ?? '';
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const archiveDate = dateRegex.test(dateParam) ? dateParam : null;

  const database = db(c.env.DB);

  // Fast path: try precomputed snapshot for public sections (no owner).
  // Personal sections (perception/improvements) always need live queries
  // since they depend on the specific owner.
  // Archive mode: only serve precomputed snapshots (no live rebuild of
  // historical data — the snapshot IS the permanent record).
  if (!ownerId) {
    const today = new Date().toISOString().slice(0, 10);
    const lookupDate = archiveDate ?? today;
    const snapshot = await tryGetPrecomputedSnapshot(database, lookupDate, region);
    if (snapshot) {
      // Historical editions remain readable under their original contract.
      // Today's cache must satisfy the current editorial gate; otherwise the
      // request recomposes from live evidence rather than serving stale demo
      // or malformed content.
      if (archiveDate || buildBriefEditionReceipt(snapshot).publishable) {
        return c.json(snapshot);
      }
    }
    // Archive mode with no snapshot: return 404 so the web route can
    // render a "no brief for this date" page instead of rebuilding live.
    if (archiveDate) {
      return c.json({ error: 'no_brief_for_date', date: archiveDate, region }, 404);
    }
  }

  const countries = countriesForRegion(region);

  const [stockResult, ideaResult, trendResult] = await Promise.all([
    safeCategory(() => buildStocks(database, countries), 'stocks'),
    safeCategory(() => buildIdeas(database, region, countries), 'ideas'),
    safeCategory(() => buildTrends(database, region, countries), 'trends'),
  ]);
  const stocks = stockResult.items;
  const ideas = ideaResult.items;
  const trends = trendResult.items;

  let perception: BriefPerceptionItem[] = [];
  let improvements: BriefImprovementItem[] = [];
  let watching: BriefWatchingItem[] = [];
  let intentItems: BriefIntentItem[] = [];
  let hasBrand = false;

  // Priority 1: a real signed-in owner with their own brand data in D1.
  if (ownerId) {
    [perception, improvements, watching, intentItems] = await Promise.all([
      safe(() => buildPerception(database, ownerId), 'perception'),
      safe(() => buildImprovements(database, ownerId), 'improvements'),
      safe(() => buildWatching(database, ownerId), 'watching'),
      // Migration 0014 is additive and may lag the application deploy. Keep
      // this query independent so a missing intent table cannot erase valid
      // mention, Agent Eval, or watchlist output.
      safe(() => buildIntentBriefItems(database, ownerId), 'intent'),
    ]);
    perception = mergeIntentIntoPerception(perception, intentItems);
    improvements = mergeIntentIntoImprovements(improvements, intentItems);
    hasBrand = perception.length > 0 || improvements.length > 0;
  }

  // Explicit seed products remain an API compatibility path for authenticated
  // delivery/tests. The public web client no longer sends this parameter.
  if (!hasBrand && productId) {
    const seeded = renderFromSeed(productId);
    if (seeded) {
      perception = seeded.perception;
      improvements = seeded.improvements;
      hasBrand = true;
    }
  }

  const snapshot: BriefSnapshot = {
    generatedAt: new Date().toISOString(),
    region,
    hasBrand,
    stocks,
    ideas,
    trends,
    watching: { items: watching },
    perception,
    improvements,
    categoryStates: {
      stocks: stockResult.state,
      ideas: ideaResult.state,
      trends: trendResult.state,
    },
  };
  return c.json(snapshot);
});

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
