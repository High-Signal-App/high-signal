import { Hono } from 'hono';
import { and, desc, eq, gte, inArray, like, lt, or, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { istDay, istDayRange } from '@high-signal/shared';
import { db, type DB, schema } from '../db';
import { encodeKeysetCursor, decodeKeysetCursor, type KeysetCursor } from '../lib/cursor';
import { eventsRollupIsReady, readEventsRollupState } from '../lib/events-rollup';
import { enrichPublishedSignals, partitionPublishable } from '../lib/signal-quality';
import sourceCatalog from '../lib/source-catalog.json';
import { buildDiggAttention, tryGetPrecomputedSnapshot } from './brief/query';

type Env = { DB: D1Database; BRIEF_CACHE?: KVNamespace };

export const dataRoute = new Hono<{ Bindings: Env }>();

const SOURCE_FAMILY_ALIASES: Record<string, string> = {
  market: 'markets',
  'regulations-gov': 'regulations',
  package: 'packages',
  osv: 'packages',
};

const SOURCE_QUERY_ALIASES: Record<string, string[]> = {
  edgar: ['edgar'],
  markets: ['markets', 'market'],
  packages: ['packages', 'package', 'osv'],
  regulations: ['regulations', 'regulations-gov'],
};

const NON_MATERIAL_EVIDENCE_FAMILIES = new Set([
  'gdelt',
  'google-trends',
  'hackernews',
  'lobsters',
  'markets',
  'producthunt',
  'reddit',
  'techmeme',
]);

// Collapse `legistar:phoenix` / `macro-rates:fred:dgs10` to the catalog family.
function family(source: string): string {
  if (source.startsWith('edgar_')) return 'edgar';
  if (source.startsWith('china-news:') || source.startsWith('news:china-news-'))
    return 'china-news';
  if (source.startsWith('scmp:') || source.startsWith('news:scmp-')) return 'scmp';
  const first = (source || 'unknown').split(':', 1)[0]!;
  return SOURCE_FAMILY_ALIASES[first] ?? first;
}

export function isMaterialEvidenceInputSource(source: string): boolean {
  // Digg retrieval is a discovery pool. It becomes evidence only after the
  // semantic/origin gates create a verified candidate, so rejected retrievals
  // must not make the Daily Brief freshness receipt look current.
  if (source.startsWith('news:digg-verification:')) return false;
  return !NON_MATERIAL_EVIDENCE_FAMILIES.has(family(source));
}

interface EvidenceInputAggregate {
  source: string;
  count: number;
  latestIngestedAt: number | null;
}

export function materialEvidenceInputReceipt(rows: EvidenceInputAggregate[]) {
  let count = 0;
  let latestIngestedAt = 0;
  for (const row of rows) {
    if (!isMaterialEvidenceInputSource(row.source)) continue;
    count += Number(row.count) || 0;
    latestIngestedAt = Math.max(latestIngestedAt, Number(row.latestIngestedAt) || 0);
  }
  return { count, latestIngestedAt };
}

async function loadMaterialEvidenceInputReceipt(
  database: ReturnType<typeof db>,
  range: { start: Date; end: Date }
) {
  const rows = await database
    .select({
      source: schema.events.source,
      count: sql<number>`count(*)`,
      latestIngestedAt: sql<number | null>`max(${schema.events.ingestedAt})`,
    })
    .from(schema.events)
    .where(and(gte(schema.events.ingestedAt, range.start), lt(schema.events.ingestedAt, range.end)))
    .groupBy(schema.events.source);
  return materialEvidenceInputReceipt(rows);
}

/**
 * Matches one catalog family against a raw `source` value.
 *
 * The column is a parameter so the identical predicate can run against
 * `events.source` or against the rollup's copy of the same raw values. Keeping
 * one definition is what makes the rollup-backed answer provably the same
 * answer as the live aggregate rather than a re-derivation of it.
 */
function sourceMatch(id: string, column: SQLiteColumn = schema.events.source) {
  if (id === 'china-news') {
    return or(like(column, 'china-news:%'), like(column, 'news:china-news-%'));
  }
  if (id === 'scmp') {
    return or(like(column, 'scmp:%'), like(column, 'news:scmp-%'));
  }
  const aliases = SOURCE_QUERY_ALIASES[id] ?? [id];
  const conditions = aliases.flatMap((alias) => [
    eq(column, alias),
    like(column, `${alias}:%`),
    sql`${column} GLOB ${`${alias}_*`}`,
  ]);
  return or(...conditions);
}

function dayRange(date: string | undefined) {
  return date ? istDayRange(date) : null;
}

interface SourceAggregateRow {
  source: string;
  n: number;
  lastObserved: number | null;
  lastIngested: number | null;
  futureCount: number;
}

/**
 * Whole-table per-source aggregate. This is the original `/data/sources`
 * query, kept verbatim as the fallback for a database where migration 0025's
 * rollup has not been populated yet.
 */
function loadSourceAggregatesLive(database: DB) {
  return (
    database
      .select({
        source: schema.events.source,
        n: sql<number>`count(*)`,
        lastObserved: sql<
          number | null
        >`max(case when ${schema.events.publishedAt} <= unixepoch() then ${schema.events.publishedAt} end)`,
        lastIngested: sql<number | null>`max(${schema.events.ingestedAt})`,
        futureCount: sql<number>`sum(case when ${schema.events.publishedAt} > unixepoch() then 1 else 0 end)`,
      })
      .from(schema.events)
      // d1-scan: reviewed-unbounded issue=#145 reason=emergency fallback only when the cron-maintained rollup is unavailable
      .groupBy(schema.events.source) as Promise<SourceAggregateRow[]>
  );
}

/** The same numbers, read from the rollup the cron materializes. */
function loadSourceAggregatesFromRollup(database: DB) {
  return database
    .select({
      source: schema.eventsSourceRollup.source,
      n: schema.eventsSourceRollup.eventCount,
      lastObserved: schema.eventsSourceRollup.latestObservedAt,
      lastIngested: schema.eventsSourceRollup.lastIngestedAt,
      futureCount: schema.eventsSourceRollup.futureCount,
    })
    .from(schema.eventsSourceRollup) as Promise<SourceAggregateRow[]>;
}

/**
 * Prefers the rollup and falls back to the live aggregate. An empty rollup
 * means "never refreshed" or "no events at all"; both are answered correctly
 * by running the live query, so no readiness probe is needed here.
 */
async function loadSourceAggregates(database: DB): Promise<SourceAggregateRow[]> {
  try {
    const rollup = await loadSourceAggregatesFromRollup(database);
    if (rollup.length > 0) return rollup;
  } catch (error) {
    console.error('[data/sources] rollup unavailable, using live aggregate', error);
  }
  return loadSourceAggregatesLive(database);
}

interface SourceTotals {
  n: number;
  latestObservedAt: number | null;
  lastIngestedAt: number | null;
  futureCount: number | null;
  /**
   * How many raw `source` values the family spans, when the rollup answered.
   * Free — it falls out of the same aggregate — and it is what lets the
   * listing skip resolving a family it is not going to seek on.
   */
  sourceCount?: number;
}

/** One family's stored-row totals, computed over `events`. */
async function readSourceTotalsLive(database: DB, where: SQL | undefined) {
  const [row] = await database
    .select({
      n: sql<number>`count(*)`,
      latestObservedAt: sql<
        number | null
      >`max(case when ${schema.events.publishedAt} <= unixepoch() then ${schema.events.publishedAt} end)`,
      lastIngestedAt: sql<number | null>`max(${schema.events.ingestedAt})`,
      futureCount: sql<number>`sum(case when ${schema.events.publishedAt} > unixepoch() then 1 else 0 end)`,
    })
    .from(schema.events)
    .where(where);
  return row as SourceTotals | undefined;
}

/**
 * The same totals folded out of the rollup. `sourceMatch` is reused verbatim
 * against the rollup's copy of the raw `source` values, so family membership
 * is decided by exactly the same predicate as the live query.
 */
async function readSourceTotalsFromRollup(database: DB, id: string) {
  const [row] = await database
    .select({
      n: sql<number>`coalesce(sum(${schema.eventsSourceRollup.eventCount}), 0)`,
      latestObservedAt: sql<number | null>`max(${schema.eventsSourceRollup.latestObservedAt})`,
      lastIngestedAt: sql<number | null>`max(${schema.eventsSourceRollup.lastIngestedAt})`,
      futureCount: sql<number>`coalesce(sum(${schema.eventsSourceRollup.futureCount}), 0)`,
      sourceCount: sql<number>`count(*)`,
    })
    .from(schema.eventsSourceRollup)
    .where(sourceMatch(id, schema.eventsSourceRollup.source));
  return row as SourceTotals | undefined;
}

// ─── Paginating the per-source event listing ──────────────────────────────
//
// `sourceMatch` cannot use an index on `source`, and that is not fixable in
// place. Its three arms are three different operator classes — `=`, `LIKE`,
// `GLOB` — OR'd together, and SQLite's OR-to-index optimization needs *every*
// arm to be index-usable. `=` and `GLOB` are (GLOB is case-sensitive, so a
// literal prefix becomes a range constraint); `LIKE` is not, because it is
// case-insensitive by default and a BINARY index cannot answer it. Rewriting
// the `LIKE` arm as `GLOB` would make the whole predicate index-usable, but it
// would also make family matching case-sensitive — a change to which rows a
// public endpoint returns, and a break in the live/rollup equivalence
// migration 0025 relies on. So the predicate stays exactly as it is.
//
// What is fixable is not needing it as the access path. The rollup already
// materializes every raw `source` value, so a family can be resolved to a
// concrete list of them and the listing can then seek on `source` instead of
// walking the whole table in `published_at` order looking for matches.

/**
 * Rows the seek plan will materialize and sort before the time-ordered scan
 * becomes the cheaper option.
 *
 * The two plans cost roughly:
 *
 *     seek ≈ familyRows                             (index seek, then sort)
 *     scan ≈ tableRows / familyRows × pageSize      (walk newest-first,
 *                                                    discarding non-matches)
 *
 * which cross at `familyRows ≈ sqrt(tableRows × pageSize)`. At production's
 * 440,246 rows and a 50-row page that is ~4,700. Rounded to 5,000 — the two
 * curves cross shallowly, so the exact value barely matters.
 */
const SEEK_PLAN_MAX_ROWS = 5000;

/**
 * Resolves one catalog family to the raw `source` values it covers, or `null`
 * when the rollup cannot answer and the caller must fall back to scanning.
 *
 * Two arms, because the rollup is up to one cron interval behind:
 *
 *  - the rollup itself, which is one row per raw `source` value (~97 rows in
 *    production);
 *  - every `source` seen since the rollup's own ingest watermark, so a source
 *    value that first appeared *after* the last rebuild is still found. That
 *    arm is pinned to `events_ingested_at_idx` with `INDEXED BY`: left to
 *    itself SQLite reads `SELECT DISTINCT source` and picks the source-leading
 *    index, which scans the whole table. Pinning it also means a dropped index
 *    fails loudly instead of silently costing 440k row reads.
 *
 * Both arms filter with the same `sourceMatch`, so membership is decided by
 * one definition rather than a re-derivation of it — the same discipline
 * migration 0025 established between the live aggregate and the rollup.
 */
async function resolveFamilySources(database: DB, id: string): Promise<string[] | null> {
  try {
    const state = await readEventsRollupState(database);
    if (!state || state.rebuiltAt <= 0) return null;
    const rollupRows = await database
      .select({ source: schema.eventsSourceRollup.source })
      .from(schema.eventsSourceRollup)
      .where(sourceMatch(id, schema.eventsSourceRollup.source));
    const recentRows = await database.all<{ source: string }>(sql`
      SELECT DISTINCT source FROM events INDEXED BY events_ingested_at_idx
      WHERE ${schema.events.ingestedAt} >= ${state.maxIngestedAt} AND ${sourceMatch(id)}`);
    return [...new Set([...rollupRows, ...recentRows].map((row) => row.source))];
  } catch (error) {
    console.error('[data/sources/:id] source resolution unavailable, scanning', error);
    return null;
  }
}

/**
 * `WHERE` fragment for "strictly after this cursor" under
 * `ORDER BY published_at DESC, id DESC`.
 *
 * The `id` comparison is the whole point: without it the boundary between two
 * pages falls inside a `published_at` tie block whose internal order is
 * undefined, and rows are silently dropped or repeated.
 */
function keysetAfter(cursor: KeysetCursor): SQL | undefined {
  const at = new Date(cursor.publishedAt * 1000);
  return or(
    lt(schema.events.publishedAt, at),
    and(eq(schema.events.publishedAt, at), lt(schema.events.id, cursor.id))
  );
}

interface Sample {
  title: string | null;
  url: string;
  publishedAt: number;
}

interface CatalogSource {
  id: string;
  cadence: 'daily' | 'context' | 'weekly' | 'monthly' | 'on_demand' | 'manual' | 'parked';
  expectedRunCadenceHours: number | null;
}

interface SourceRun {
  source: string;
  startedAt: Date;
  finishedAt: Date | null;
  eventsFetched: number | null;
  errors: number | null;
}

const CATALOG_SOURCES = sourceCatalog.sources as CatalogSource[];
const SOURCE_STATUS_CACHE_TTL_SECONDS = 6 * 60 * 60;

export function sourceStatusCacheKey(sampleLimit: number) {
  return `data:sources:v2:samples:${sampleLimit}`;
}

export function sourceRunStatus(
  cadence: CatalogSource['cadence'],
  run: SourceRun | undefined
):
  | 'parked'
  | 'manual'
  | 'on_demand'
  | 'unknown'
  | 'failed'
  | 'success_empty'
  | 'success_with_data' {
  if (cadence === 'parked') return 'parked';
  if (cadence === 'manual') return 'manual';
  if (cadence === 'on_demand' && !run) return 'on_demand';
  if (!run) return 'unknown';
  if ((run.errors ?? 0) > 0) return 'failed';
  return (run.eventsFetched ?? 0) > 0 ? 'success_with_data' : 'success_empty';
}

export function resolveDailyDate(value: string | undefined, now = new Date()): string | null {
  if (value === undefined) return istDay(now);
  return istDayRange(value) ? value : null;
}

export function dailyEvidenceEvents(
  rows: Array<typeof schema.evidence.$inferSelect>,
  signalSlugs: ReadonlyMap<string, string>
) {
  return rows.map((row) => ({
    id: row.id,
    signalId: row.signalId,
    signalSlug: signalSlugs.get(row.signalId) ?? null,
    url: row.url,
    sourceType: row.sourceType,
    excerpt: row.excerpt,
    publishedAt: row.publishedAt,
  }));
}

/**
 * GET /data/daily — complete public dump of one IST day's published signals
 * and the canonical evidence events linked to those signals.
 */
dataRoute.get('/daily', async (c) => {
  const date = resolveDailyDate(c.req.query('date'));
  if (!date) return c.json({ error: 'invalid_date', expected: 'YYYY-MM-DD' }, 400);

  const range = dayRange(date)!;
  const database = db(c.env.DB);
  const rows = await database
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, 'published'),
        sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`,
        gte(schema.signals.publishedAt, range.start),
        lt(schema.signals.publishedAt, range.end)
      )
    )
    .orderBy(desc(schema.signals.publishedAt));

  const { published: signals, withheldCount } = partitionPublishable(
    await enrichPublishedSignals(c.env.DB, rows)
  );

  const evidenceInputReceipt = await loadMaterialEvidenceInputReceipt(database, range);

  const signalIds = signals.map((signal) => signal.id);
  const evidenceRows = signalIds.length
    ? await database
        .select()
        .from(schema.evidence)
        .where(inArray(schema.evidence.signalId, signalIds))
        .orderBy(desc(schema.evidence.publishedAt))
    : [];
  const slugs = new Map(signals.map((signal) => [signal.id, signal.slug]));
  const evidenceEvents = dailyEvidenceEvents(evidenceRows, slugs);
  const isToday = date === istDay();
  const archivedBrief = isToday ? null : await tryGetPrecomputedSnapshot(database, date, 'global');
  const attention = isToday
    ? await buildDiggAttention(database)
    : {
        attentionLeaders: archivedBrief?.attentionLeaders ?? [],
        emergingBeforeMainstream: archivedBrief?.emergingBeforeMainstream ?? [],
        attentionEvidenceGaps: archivedBrief?.attentionEvidenceGaps ?? [],
      };
  const attentionObservationCount =
    attention.attentionLeaders.length +
    attention.emergingBeforeMainstream.length +
    attention.attentionEvidenceGaps.length;

  return c.json(
    {
      schemaVersion: '1',
      generatedAt: new Date().toISOString(),
      date,
      evidenceInputCount: evidenceInputReceipt.count,
      latestEvidenceInputAt: evidenceInputReceipt.latestIngestedAt
        ? new Date(evidenceInputReceipt.latestIngestedAt * 1000).toISOString()
        : null,
      signalCount: signals.length,
      withheldCount,
      evidenceEventCount: evidenceEvents.length,
      attentionObservationCount,
      attentionAvailable: isToday || archivedBrief?.attentionLeaders !== undefined,
      signals,
      evidenceEvents,
      attention,
    },
    200,
    { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
  );
});

/**
 * GET /data/sources — catalog-complete stored-data and adapter-run status.
 * Representative samples are opt-in (`?samples=1..10`) to keep the default
 * public directory read cost bounded.
 */
dataRoute.get('/sources', async (c) => {
  const requestedSamples = Number(c.req.query('samples') ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(requestedSamples) ? requestedSamples : 0, 0), 10);
  const cacheKey = sourceStatusCacheKey(limit);
  if (c.env.BRIEF_CACHE) {
    try {
      const cached = await c.env.BRIEF_CACHE.get(cacheKey, 'json');
      if (cached) {
        return c.json(cached, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=3600' });
      }
    } catch (error) {
      console.error('[data/sources] shared cache read failed', error);
    }
  }
  const database = db(c.env.DB);
  const generatedAt = new Date().toISOString();

  // Aggregate stored rows, observation time, and ingestion time separately.
  // `published_at` may be a future effective/due date, so it cannot by itself
  // prove that a source is fresh or determine the latest browsable source day.
  // Served from the cron-maintained rollup, so these counts are at most one
  // cron interval (30 minutes) behind `events`.
  let rows: SourceAggregateRow[] = [];
  try {
    rows = await loadSourceAggregates(database);
  } catch {
    return c.json(
      {
        schemaVersion: '2',
        generatedAt,
        sources: CATALOG_SOURCES.map((source) => ({
          id: source.id,
          count: 0,
          lastAt: 0,
          latestObservedAt: 0,
          lastIngestedAt: 0,
          futureCount: 0,
          lastRunAt: 0,
          lastRunFinishedAt: 0,
          lastRunEventsFetched: 0,
          lastRunErrors: 0,
          runStatus: sourceRunStatus(source.cadence, undefined),
          cadence: source.cadence,
          samples: [],
        })),
        total: 0,
        available: false,
        samplesAvailable: false,
        uncataloguedSources: [],
      },
      200,
      { 'Cache-Control': 'public, max-age=60, s-maxage=3600' }
    );
  }

  // Rank within each raw source before normalizing to a family. This prevents
  // high-volume feeds such as markets/GDELT from crowding every other family
  // out of the representative sample set.
  let recent: Array<{ source: string; title: string | null; url: string; publishedAt: number }> =
    [];
  let samplesAvailable = true;
  if (limit > 0) {
    try {
      const result = await c.env.DB.prepare(
        `WITH ranked AS (
           SELECT source, title, source_url AS url, published_at AS publishedAt,
                  row_number() OVER (
                    PARTITION BY source
                    ORDER BY CASE WHEN published_at <= unixepoch() THEN 0 ELSE 1 END,
                             published_at DESC
                  ) AS source_rank
           FROM events
         )
         SELECT source, title, url, publishedAt
         FROM ranked
         WHERE source_rank <= ?
         ORDER BY publishedAt DESC`
      )
        .bind(limit)
        .all();
      recent = (result.results ?? []) as typeof recent;
    } catch {
      samplesAvailable = false;
    }
  }

  let runRows: SourceRun[] = [];
  try {
    runRows = await database
      .select({
        source: schema.ingestRuns.source,
        startedAt: schema.ingestRuns.startedAt,
        finishedAt: schema.ingestRuns.finishedAt,
        eventsFetched: schema.ingestRuns.eventsFetched,
        errors: schema.ingestRuns.errors,
      })
      .from(schema.ingestRuns)
      .where(
        inArray(
          schema.ingestRuns.source,
          CATALOG_SOURCES.map((source) => source.id)
        )
      )
      .orderBy(desc(schema.ingestRuns.startedAt))
      .limit(1000);
  } catch {
    // Event inventory remains useful when run receipts are temporarily absent.
  }

  const counts = new Map<
    string,
    { count: number; latestObservedAt: number; lastIngestedAt: number; futureCount: number }
  >();
  for (const r of rows) {
    const fam = family(r.source);
    const cur = counts.get(fam) ?? {
      count: 0,
      latestObservedAt: 0,
      lastIngestedAt: 0,
      futureCount: 0,
    };
    cur.count += Number(r.n) || 0;
    cur.latestObservedAt = Math.max(cur.latestObservedAt, Number(r.lastObserved) || 0);
    cur.lastIngestedAt = Math.max(cur.lastIngestedAt, Number(r.lastIngested) || 0);
    cur.futureCount += Number(r.futureCount) || 0;
    counts.set(fam, cur);
  }

  const samples = new Map<string, Sample[]>();
  for (const r of recent) {
    const fam = family(r.source);
    const arr = samples.get(fam) ?? [];
    if (arr.length < limit) {
      arr.push({
        title: r.title,
        url: r.url,
        publishedAt: Number(r.publishedAt),
      });
      samples.set(fam, arr);
    }
  }

  const latestRun = new Map<string, SourceRun>();
  for (const run of runRows) {
    if (!latestRun.has(run.source)) latestRun.set(run.source, run);
  }

  const catalogIds = new Set(CATALOG_SOURCES.map((source) => source.id));
  const sources = CATALOG_SOURCES.map((source) => {
    const stored = counts.get(source.id) ?? {
      count: 0,
      latestObservedAt: 0,
      lastIngestedAt: 0,
      futureCount: 0,
    };
    const run = latestRun.get(source.id);
    return {
      id: source.id,
      count: stored.count,
      // `lastAt` remains as a compatibility alias for existing clients.
      lastAt: stored.latestObservedAt,
      latestObservedAt: stored.latestObservedAt,
      lastIngestedAt: stored.lastIngestedAt,
      futureCount: stored.futureCount,
      lastRunAt: run ? Math.floor(run.startedAt.getTime() / 1000) : 0,
      lastRunFinishedAt: run?.finishedAt ? Math.floor(run.finishedAt.getTime() / 1000) : 0,
      lastRunEventsFetched: run?.eventsFetched ?? 0,
      lastRunErrors: run?.errors ?? 0,
      runStatus: sourceRunStatus(source.cadence, run),
      cadence: source.cadence,
      samples: samples.get(source.id) ?? [],
    };
  });

  const payload = {
    schemaVersion: '2',
    generatedAt,
    sources,
    total: [...counts.values()].reduce((sum, source) => sum + source.count, 0),
    available: true,
    samplesAvailable,
    uncataloguedSources: [...counts.keys()].filter((id) => !catalogIds.has(id)).sort(),
  };
  if (c.env.BRIEF_CACHE) {
    try {
      await c.env.BRIEF_CACHE.put(cacheKey, JSON.stringify(payload), {
        expirationTtl: SOURCE_STATUS_CACHE_TTL_SECONDS,
      });
    } catch (error) {
      console.error('[data/sources] shared cache write failed', error);
    }
  }
  return c.json(payload, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=3600' });
});

/**
 * GET /data/sources/:id — paginated raw events for one source family, newest
 * first. Powers the /data/[source] drill-in ("click on data to view it").
 * Matches the family and any `family:variant` sub-source (e.g. legistar:phoenix).
 *
 * Pagination is keyset-first: `?cursor=` walks a total order over
 * `(published_at, id)`. `?offset=` still works unchanged for existing callers,
 * but it is the weaker mode — it re-walks everything it skips, and its window
 * is only well defined because the `ORDER BY` now carries the `id` tiebreaker.
 *
 * Filters (`date`, `source`) are applied in SQL, never to a broad result set
 * in JS.
 */
dataRoute.get('/sources/:id', async (c) => {
  const id = c.req.param('id');
  const requestedLimit = Number(c.req.query('limit') ?? 50);
  const requestedOffset = Number(c.req.query('offset') ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 200);
  const date = c.req.query('date');
  if (date !== undefined && dayRange(date) === null) {
    return c.json({ error: 'invalid_date', expected: 'YYYY-MM-DD' }, 400);
  }
  const rawCursor = c.req.query('cursor');
  const cursor = rawCursor === undefined ? null : decodeKeysetCursor(rawCursor);
  if (rawCursor !== undefined && cursor === null) {
    return c.json({ error: 'invalid_cursor', expected: 'a cursor from a previous response' }, 400);
  }
  // A cursor already encodes the position, so `offset` is ignored alongside it
  // rather than compounding with it.
  const offset = cursor ? 0 : Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0);
  // Narrows to one raw `source` value inside the family. An equality on an
  // indexed column, so it is a seek rather than a filter over a wide scan.
  const sourceFilter = c.req.query('source');

  const database = db(c.env.DB);
  const match = sourceMatch(id);
  const range = dayRange(date);
  const filters = [
    ...(range
      ? [gte(schema.events.publishedAt, range.start), lt(schema.events.publishedAt, range.end)]
      : []),
    ...(sourceFilter ? [eq(schema.events.source, sourceFilter)] : []),
  ];
  // Totals describe the filtered set, so `?source=`/`?date=` narrow them too.
  const where = filters.length ? and(match, ...filters) : match;

  let total = 0;
  let latestObservedAt = 0;
  let lastIngestedAt = 0;
  let futureCount = 0;
  let sourceCount: number | null = null;
  try {
    // Unfiltered totals come from the cron-maintained rollup (at most 30
    // minutes behind); a `?date=` or `?source=` request still asks `events`
    // directly, because the rollup carries no per-day breakdown and a
    // single-source total is already an index seek.
    const row =
      filters.length === 0 && (await eventsRollupIsReady(database))
        ? await readSourceTotalsFromRollup(database, id)
        : await readSourceTotalsLive(database, where);
    total = Number(row?.n ?? 0);
    latestObservedAt = Number(row?.latestObservedAt ?? 0);
    lastIngestedAt = Number(row?.lastIngestedAt ?? 0);
    futureCount = Number(row?.futureCount ?? 0);
    sourceCount = row?.sourceCount === undefined ? null : Number(row.sourceCount);
  } catch {
    return c.json({
      id,
      date: range ? date : undefined,
      total: 0,
      latestObservedAt: 0,
      lastIngestedAt: 0,
      futureCount: 0,
      events: [],
      hasMore: false,
      nextCursor: null,
      available: false,
    });
  }

  // Plan choice. `?source=` is already a `source = ?` equality, so SQLite can
  // seek on `events_source_rollup_idx` without any help. Otherwise the family
  // is worth resolving to concrete source values only when seeking would beat
  // walking `published_at` — see SEEK_PLAN_MAX_ROWS.
  //
  // A family that is both large and spread across several source values can be
  // ruled out before resolving anything: the rollup's own `count(*)` already
  // said how many source values it spans, so the probe is skipped rather than
  // run and discarded.
  let candidates: string[] | null = null;
  const worthResolving =
    !sourceFilter && (total <= SEEK_PLAN_MAX_ROWS || sourceCount === null || sourceCount === 1);
  if (worthResolving) {
    const resolved = await resolveFamilySources(database, id);
    // One candidate is always worth seeking: SQLite walks the index already
    // ordered by `published_at` and needs only an incremental sort for `id`.
    if (resolved && (resolved.length === 1 || total <= SEEK_PLAN_MAX_ROWS)) {
      candidates = resolved;
    }
  }
  const access =
    candidates === null
      ? where
      : candidates.length === 0
        ? // The family covers no source at all; `1 = 0` keeps the shape without
          // an `IN ()` that SQLite would reject.
          sql`1 = 0`
        : and(inArray(schema.events.source, candidates), ...filters);

  const cursorFilter = cursor ? keysetAfter(cursor) : undefined;
  // One extra row decides `hasMore` exactly, instead of inferring it from a
  // `total` the rollup may have computed up to 30 minutes ago.
  const rows = await database
    .select({
      id: schema.events.id,
      title: schema.events.title,
      content: schema.events.content,
      url: schema.events.sourceUrl,
      source: schema.events.source,
      entity: schema.events.primaryEntityId,
      publishedAt: schema.events.publishedAt,
    })
    .from(schema.events)
    .where(cursorFilter ? and(access, cursorFilter) : access)
    // `id` is the unique tiebreaker. Without it a `LIMIT` over `published_at`
    // alone is not a well-defined window and pages overlap inside tie blocks.
    .orderBy(desc(schema.events.publishedAt), desc(schema.events.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const events = page.map((r) => ({
    title: r.title,
    content: r.content,
    url: r.url,
    source: r.source,
    entity: r.entity,
    publishedAt:
      r.publishedAt instanceof Date
        ? Math.floor(r.publishedAt.getTime() / 1000)
        : Number(r.publishedAt),
  }));

  const last = page.at(-1);
  return c.json({
    id,
    date: range ? date : undefined,
    total,
    latestObservedAt,
    lastIngestedAt,
    futureCount,
    events,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeKeysetCursor({
            publishedAt:
              last.publishedAt instanceof Date
                ? Math.floor(last.publishedAt.getTime() / 1000)
                : Number(last.publishedAt),
            id: last.id,
          })
        : null,
    available: true,
  });
});
