/**
 * Daily Brief route. The single composed surface for High Signal.
 *
 * GET /brief/daily?region=<region>&date=<YYYY-MM-DD>
 *
 * - Three public sections (stocks / ideas / trends) compose without a user.
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
  categoryStatesForSnapshot,
  countriesForRegion,
  isProtectedHistoryDay,
  isRegion,
  istDay,
  istDayFromTimestamp,
  pruneUnpublishableBriefItems,
  summarizeBriefDiscovery,
  type BriefCategoryStates,
  type BriefSnapshot,
  type Region,
} from '@high-signal/shared';
import { db, schema } from '../../db';
import { safe, safeCategory, withBriefNews } from './compose';
import {
  buildDiggAttention,
  buildIdeas,
  buildNews,
  buildStocks,
  buildTrends,
  tryGetPrecomputedSnapshot,
} from './query';
import { bearerGrant, verifyHistoryGrant } from '../../lib/history-access';

type Env = { DB: D1Database; BRIEF_CACHE?: KVNamespace; TURNSTILE_SECRET?: string };

function isPublicNewsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Publication readiness for the whole reader edition, including news. */
function buildDailyBriefReceipt(snapshot: BriefSnapshot) {
  const signalReceipt = buildBriefEditionReceipt(snapshot);
  const news = snapshot.news ?? [];
  const issues: Array<{ section: string; item: number | null; reason: string }> =
    signalReceipt.issues.filter(
      (issue) =>
        !(news.length > 0 && issue.section === 'edition' && issue.reason === 'edition_has_no_items')
    );

  news.forEach((item, index) => {
    if (typeof item.title !== 'string' || !item.title.trim()) {
      issues.push({ section: 'news', item: index, reason: 'missing_title' });
    }
    if (typeof item.event_at !== 'string' || !Number.isFinite(Date.parse(item.event_at))) {
      issues.push({ section: 'news', item: index, reason: 'missing_publication_date' });
    }
    if (
      !Array.isArray(item.source_references) ||
      !item.source_references.some((citation) => citation && isPublicNewsUrl(citation.url))
    ) {
      issues.push({ section: 'news', item: index, reason: 'missing_public_source' });
    }
  });

  const counts = { news: news.length, ...signalReceipt.counts };
  return {
    publishable: Object.values(counts).some((count) => count > 0) && issues.length === 0,
    counts,
    issues,
  };
}

/**
 * The publish cron runs at 03:30 UTC (09:00 IST) daily. When no precomputed
 * snapshot exists for today yet, this returns the next occurrence so agents
 * know when to retry instead of interpreting an empty/pending brief as a
 * genuinely quiet day.
 */
function nextExpectedPublishAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(3, 30);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

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
  const editionDate = request.archiveDate ?? istDay();

  const cached = await cachedDailyBrief(database, request);
  if (cached) {
    if (cached.status === 200) {
      let snapshot = cached.body;
      // The public two-day signal ledger stays current when publication happens
      // after a region snapshot was computed. Never substitute a stale cached
      // stock section if this authoritative read fails.
      if (!protectedHistory) {
        const stocks = await safeCategory(
          () => buildStocks(database, countriesForRegion(request.region), editionDate),
          'stocks'
        );
        snapshot = pruneUnpublishableBriefItems({
          ...snapshot,
          stocks: stocks.items,
          categoryStates: { ...categoryStatesForSnapshot(snapshot), stocks: stocks.state },
        }).snapshot;
      }
      snapshot = dailySignalEdition(pruneUnpublishableBriefItems(snapshot).snapshot, editionDate);
      snapshot = await refreshSnapshotNews(
        database,
        snapshot,
        request.region,
        editionDate,
        !protectedHistory || snapshot.news == null
      );
      const body = {
        ...snapshot,
        publishStatus: buildDailyBriefReceipt(snapshot).publishable
          ? ('published' as const)
          : ('pending' as const),
      };
      return c.json(body, cached.status);
    }
    return c.json(cached.body, cached.status);
  }

  const snapshot = dailySignalEdition(
    pruneUnpublishableBriefItems(await composeDailyBrief(database, request)).snapshot,
    editionDate
  );
  // No precomputed snapshot for today — the publish cron hasn't run yet.
  // Mark it pending so agents don't mistake stale content for today's edition.
  if (!protectedHistory) {
    return c.json({
      ...snapshot,
      publishStatus: 'pending' as const,
      nextExpectedPublishAt: nextExpectedPublishAt(),
    });
  }
  return c.json(snapshot);
}

/** A rolling composition must not relabel older signals as today's publications. */
export function dailySignalEdition(snapshot: BriefSnapshot, editionDate: string): BriefSnapshot {
  const publicSnapshot = { ...snapshot } as BriefSnapshot & {
    hasBrand?: unknown;
    perception?: unknown;
    improvements?: unknown;
  };
  delete publicSnapshot.hasBrand;
  delete publicSnapshot.perception;
  delete publicSnapshot.improvements;
  const stocks = publicSnapshot.stocks.filter(
    (item) => item.publishedAt && istDayFromTimestamp(item.publishedAt) === editionDate
  );
  return {
    ...publicSnapshot,
    editionDate,
    timeZone: 'Asia/Kolkata',
    stocks,
    ...(publicSnapshot.categoryStates
      ? {
          categoryStates: {
            ...publicSnapshot.categoryStates,
            stocks:
              publicSnapshot.categoryStates.stocks.status === 'unavailable'
                ? publicSnapshot.categoryStates.stocks
                : {
                    ...publicSnapshot.categoryStates.stocks,
                    status: stocks.length ? 'ready' : 'empty',
                    reason: stocks.length ? null : 'no_qualifying_items',
                  },
          },
        }
      : {}),
  };
}

export function parseDailyBriefRequest(c: Context<{ Bindings: Env }>) {
  const rawRegion = c.req.query('region')?.toLowerCase().trim() ?? 'global';
  const dateParam = c.req.query('date')?.trim() ?? '';
  return {
    region: (isRegion(rawRegion) ? rawRegion : 'global') as Region,
    archiveDate: /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null,
  };
}

async function cachedDailyBrief(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>
) {
  const lookupDate = request.archiveDate ?? istDay();
  const snapshot = await tryGetPrecomputedSnapshot(database, lookupDate, request.region);
  if (snapshot && (request.archiveDate || buildDailyBriefReceipt(snapshot).publishable)) {
    return { body: snapshot, status: 200 as const };
  }
  if (request.archiveDate && isProtectedHistoryDay(request.archiveDate)) {
    return {
      body: { error: 'no_brief_for_date', date: request.archiveDate, region: request.region },
      status: 404 as const,
    };
  }
  return null;
}

async function refreshSnapshotNews(
  database: ReturnType<typeof db>,
  snapshot: BriefSnapshot,
  region: Region,
  editionDate: string,
  shouldRefresh: boolean
): Promise<BriefSnapshot> {
  if (!shouldRefresh) return snapshot;
  try {
    return withBriefNews(snapshot, await buildNews(database, region, editionDate));
  } catch (error) {
    console.warn('[brief] news refresh unavailable', error);
    return snapshot.news == null ? withBriefNews(snapshot, []) : snapshot;
  }
}

async function composeDailyBrief(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>
) {
  const countries = countriesForRegion(request.region);
  const editionDate = request.archiveDate ?? istDay();
  const [stockResult, ideaResult, trendResult, attention, news] = await Promise.all([
    safeCategory(() => buildStocks(database, countries, editionDate), 'stocks'),
    safeCategory(() => buildIdeas(database, request.region, countries), 'ideas'),
    safeCategory(() => buildTrends(database, request.region, countries), 'trends'),
    buildDiggAttention(database),
    safe(() => buildNews(database, request.region, editionDate), 'news'),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    region: request.region,
    stocks: stockResult.items,
    ideas: ideaResult.items,
    trends: trendResult.items,
    news,
    ...attention,
    categoryStates: {
      stocks: stockResult.state,
      ideas: ideaResult.state,
      trends: trendResult.state,
    },
  } satisfies BriefSnapshot;
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
  counts?: { news: number; stocks: number; ideas: number; trends: number };
  issues?: Array<{ section: string; item: number | null; reason: string }>;
}

interface BriefPrecomputeResult {
  date: string;
  globalPublished: boolean;
  regions: BriefPrecomputeRegionResult[];
}

async function precomputeBriefRegion(
  database: ReturnType<typeof db>,
  region: Region,
  today: string,
  nowIso: string
): Promise<BriefPrecomputeRegionResult> {
  try {
    const countries = countriesForRegion(region);
    const [stockResult, ideaResult, trendResult, attention, news] = await Promise.all([
      safeCategory(() => buildStocks(database, countries, today), 'stocks'),
      safeCategory(() => buildIdeas(database, region, countries), 'ideas'),
      safeCategory(() => buildTrends(database, region, countries), 'trends'),
      buildDiggAttention(database),
      safe(() => buildNews(database, region, today), 'news'),
    ]);
    const snapshot: BriefSnapshot = {
      generatedAt: nowIso,
      region,
      stocks: stockResult.items,
      ideas: ideaResult.items,
      trends: trendResult.items,
      news,
      ...attention,
      categoryStates: {
        stocks: stockResult.state,
        ideas: ideaResult.state,
        trends: trendResult.state,
      } satisfies BriefCategoryStates,
    };
    const pruned = pruneUnpublishableBriefItems(snapshot);
    const publishedSnapshot = pruned.snapshot;
    if (pruned.withheld.length > 0) {
      console.error(
        `[brief-precompute] ${region} withheld ${pruned.withheld.length} item(s) on ${today}`,
        JSON.stringify(pruned.withheld)
      );
    }

    const receipt = buildDailyBriefReceipt(publishedSnapshot);
    if (!receipt.publishable) {
      console.error(
        `[brief-precompute] ${region} REJECTED on ${today} — no snapshot written`,
        JSON.stringify({ counts: receipt.counts, issues: receipt.issues })
      );
      return { region, status: 'rejected', counts: receipt.counts, issues: receipt.issues };
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
        set: { briefJson: JSON.stringify(publishedSnapshot), computedAt: nowIso },
      });
    console.log(
      `[brief-precompute] ${region}: ${publishedSnapshot.news?.length ?? 0} news, ${publishedSnapshot.stocks.length} stocks, ${publishedSnapshot.ideas.length} ideas, ${publishedSnapshot.trends.length} trends, ${publishedSnapshot.attentionLeaders?.length ?? 0} attention leaders, ${pruned.withheld.length} withheld; gate=pass`
    );
    return { region, status: 'published', counts: receipt.counts };
  } catch (err) {
    console.error(`[brief-precompute] ${region} failed:`, err);
    return { region, status: 'failed' };
  }
}

export async function precomputeBriefSnapshots(env: {
  DB: D1Database;
}): Promise<BriefPrecomputeResult> {
  const database = db(env.DB);
  const date = istDay();
  const nowIso = new Date().toISOString();
  const regions: BriefPrecomputeRegionResult[] = [];
  for (const region of PRECOMPUTED_REGIONS) {
    regions.push(await precomputeBriefRegion(database, region, date, nowIso));
  }
  return {
    date,
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
      // d1-scan: reviewed-unbounded issue=#145 reason=one row per day-region with a 500-date response ceiling
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
