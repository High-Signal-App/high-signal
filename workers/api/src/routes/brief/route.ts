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
  sanitizeBriefNewsItems,
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
import {
  observeStages,
  setServerTiming,
  timeServerStage,
  type InnerCacheStatus,
  type ServerTimingEntry,
} from '../../lib/server-timing';

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

/**
 * Matches the public edge cache's `s-maxage=300`: a published edition read
 * from KV is never older than one edge-cache lifetime, so stock and news
 * refreshes reach readers on the same bound as before.
 */
export const DAILY_BRIEF_CACHE_TTL_SECONDS = 300;

export function dailyBriefCacheKey(region: Region, editionDate: string) {
  return `brief:daily:v1:${region}:${editionDate}`;
}

export const briefRoute = new Hono<{ Bindings: Env }>();

briefRoute.get('/daily', async (c) => handleDailyBriefRequest(c));

async function handleDailyBriefRequest(c: Context<{ Bindings: Env }>) {
  const timings: ServerTimingEntry[] = [];
  const diagnostics = c.req.query('timing') === '1';
  const request = parseDailyBriefRequest(c);
  const editionDate = request.archiveDate ?? istDay();
  const shared = await readSharedDailyBrief(c, request, editionDate, timings, diagnostics);
  if (shared.hit) {
    setServerTiming(c, timings, diagnostics);
    return c.json(shared.hit, 200);
  }
  const response = await serveDailyBrief(c, request, editionDate, timings, diagnostics);
  await shared.store(response);
  return response;
}

async function serveDailyBrief(
  c: Context<{ Bindings: Env }>,
  request: ReturnType<typeof parseDailyBriefRequest>,
  editionDate: string,
  timings: ServerTimingEntry[],
  diagnostics: boolean
) {
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
  const diagnosticNewsTimings = diagnostics ? timings : undefined;

  const cached = await timeServerStage(timings, 'snapshot', () =>
    cachedDailyBrief(database, request)
  );
  if (cached) {
    if (cached.status === 200) {
      let snapshot = cached.body;
      // The public two-day signal ledger stays current when publication happens
      // after a region snapshot was computed. Never substitute a stale cached
      // stock section if this authoritative read fails.
      if (!protectedHistory) {
        const [stocks, refreshedSnapshot] = await Promise.all([
          safeCategory(
            () =>
              timeServerStage(timings, 'stocks', () =>
                buildStocks(database, countriesForRegion(request.region), editionDate)
              ),
            'stocks'
          ),
          refreshSnapshotNews(
            database,
            snapshot,
            request.region,
            editionDate,
            true,
            timings,
            diagnosticNewsTimings
          ),
        ]);
        snapshot = pruneUnpublishableBriefItems({
          ...snapshot,
          stocks: stocks.items,
          categoryStates: { ...categoryStatesForSnapshot(snapshot), stocks: stocks.state },
        }).snapshot;
        snapshot = { ...snapshot, news: refreshedSnapshot.news };
      }
      snapshot = dailySignalEdition(pruneUnpublishableBriefItems(snapshot).snapshot, editionDate);
      if (protectedHistory) {
        snapshot = await refreshSnapshotNews(
          database,
          snapshot,
          request.region,
          editionDate,
          snapshot.news == null,
          timings,
          diagnosticNewsTimings
        );
      }
      const body = {
        ...snapshot,
        publishStatus: buildDailyBriefReceipt(snapshot).publishable
          ? ('published' as const)
          : ('pending' as const),
      };
      setServerTiming(c, timings, diagnostics);
      return c.json(body, cached.status);
    }
    setServerTiming(c, timings, diagnostics);
    return c.json(cached.body, cached.status);
  }

  const snapshot = dailySignalEdition(
    pruneUnpublishableBriefItems(
      await composeDailyBrief(database, request, timings, diagnosticNewsTimings)
    ).snapshot,
    editionDate
  );
  // No precomputed snapshot for today — the publish cron hasn't run yet.
  // Mark it pending so agents don't mistake stale content for today's edition.
  if (!protectedHistory) {
    setServerTiming(c, timings, diagnostics);
    return c.json({
      ...snapshot,
      publishStatus: 'pending' as const,
      nextExpectedPublishAt: nextExpectedPublishAt(),
    });
  }
  setServerTiming(c, timings, diagnostics);
  return c.json(snapshot);
}

type SharedDailyBrief = {
  hit: Record<string, unknown> | null;
  /** Shares a successful, published current-day response; anything else is skipped. */
  store: (response: Response) => Promise<void>;
};

/**
 * Current-day public editions are shared through KV, so a miss in one colo's
 * edge cache costs one KV read instead of ~5 D1 round trips (snapshot, stocks,
 * news window/query). Diagnostics stay SQL-only unless they opt in with
 * `cache=observe`, matching `/data/sources`. KV failures fall back to D1.
 */
async function readSharedDailyBrief(
  c: Context<{ Bindings: Env }>,
  request: ReturnType<typeof parseDailyBriefRequest>,
  editionDate: string,
  timings: ServerTimingEntry[],
  diagnostics: boolean
): Promise<SharedDailyBrief> {
  const observeCache = diagnostics && c.req.query('cache') === 'observe';
  const sharedCache = c.env.BRIEF_CACHE;
  const eligible = !request.archiveDate && (!diagnostics || observeCache);
  const key = dailyBriefCacheKey(request.region, editionDate);
  const mark = (status: InnerCacheStatus) => {
    observeStages(c.req.raw, timings, status);
    if (observeCache && status !== 'BYPASS') c.header('X-Brief-Cache', status);
  };
  mark(!eligible ? 'BYPASS' : sharedCache ? 'MISS' : 'UNAVAILABLE');
  const noop = { hit: null, store: async () => undefined };
  if (!eligible || !sharedCache) return noop;
  try {
    const hit = await timeServerStage(timings, 'kv_read', () =>
      sharedCache.get<Record<string, unknown>>(key, 'json')
    );
    if (hit) {
      mark('HIT');
      return { ...noop, hit };
    }
  } catch (error) {
    mark('ERROR');
    console.error('[brief/daily] shared cache read failed', error);
  }
  return {
    hit: null,
    store: async (response) => {
      if (response.status !== 200) return;
      const text = await response.clone().text();
      let published = false;
      try {
        published = (JSON.parse(text) as { publishStatus?: unknown }).publishStatus === 'published';
      } catch {
        return;
      }
      if (!published) return;
      const write = sharedCache
        .put(key, text, { expirationTtl: DAILY_BRIEF_CACHE_TTL_SECONDS })
        .catch((error) => console.error('[brief/daily] shared cache write failed', error));
      try {
        c.executionCtx.waitUntil(write);
      } catch {
        // No execution context (direct app.fetch in tests): finish inline.
        await write;
      }
    },
  };
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
  shouldRefresh: boolean,
  timings: ServerTimingEntry[],
  diagnosticNewsTimings?: ServerTimingEntry[]
): Promise<BriefSnapshot> {
  if (!shouldRefresh) return snapshot;
  const cachedNews = sanitizeBriefNewsItems(snapshot.news ?? []);
  try {
    const refreshed = await timeServerStage(timings, 'news', () =>
      diagnosticNewsTimings
        ? buildNews(database, region, editionDate, undefined, diagnosticNewsTimings)
        : buildNews(database, region, editionDate)
    );
    return withBriefNews(snapshot, refreshed.length > 0 ? refreshed : cachedNews);
  } catch (error) {
    console.warn('[brief] news refresh unavailable', error);
    return withBriefNews(snapshot, cachedNews);
  }
}

async function composeDailyBrief(
  database: ReturnType<typeof db>,
  request: ReturnType<typeof parseDailyBriefRequest>,
  timings: ServerTimingEntry[],
  diagnosticNewsTimings?: ServerTimingEntry[]
) {
  const countries = countriesForRegion(request.region);
  const editionDate = request.archiveDate ?? istDay();
  const [stockResult, ideaResult, trendResult, attention, news] = await Promise.all([
    safeCategory(
      () => timeServerStage(timings, 'stocks', () => buildStocks(database, countries, editionDate)),
      'stocks'
    ),
    safeCategory(() => buildIdeas(database, request.region, countries), 'ideas'),
    safeCategory(() => buildTrends(database, request.region, countries), 'trends'),
    buildDiggAttention(database),
    safe(
      () =>
        timeServerStage(timings, 'news', () =>
          diagnosticNewsTimings
            ? buildNews(database, request.region, editionDate, undefined, diagnosticNewsTimings)
            : buildNews(database, request.region, editionDate)
        ),
      'news'
    ),
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
    const existing = await tryGetPrecomputedSnapshot(database, today, region);
    const countries = countriesForRegion(region);
    const [stockResult, ideaResult, trendResult, attention, refreshedNews] = await Promise.all([
      safeCategory(() => buildStocks(database, countries, today), 'stocks'),
      safeCategory(() => buildIdeas(database, region, countries), 'ideas'),
      safeCategory(() => buildTrends(database, region, countries), 'trends'),
      buildDiggAttention(database),
      safe(() => buildNews(database, region, today), 'news'),
    ]);
    const cachedNews = sanitizeBriefNewsItems(existing?.news ?? []);
    const news = refreshedNews.length > 0 ? refreshedNews : cachedNews;
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
