import { Hono } from 'hono';
import { and, desc, eq, gte, inArray, like, lt, or, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { istDay, istDayRange } from '@high-signal/shared';
import { db, type DB, schema } from '../db';
import { eventsRollupIsReady } from '../lib/events-rollup';
import { enrichPublishedSignals, partitionPublishable } from '../lib/signal-quality';
import sourceCatalog from '../lib/source-catalog.json';
import { buildDiggAttention, tryGetPrecomputedSnapshot } from './brief/query';

type Env = { DB: D1Database };

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
  return database
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
    .groupBy(schema.events.source) as Promise<SourceAggregateRow[]>;
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
    })
    .from(schema.eventsSourceRollup)
    .where(sourceMatch(id, schema.eventsSourceRollup.source));
  return row as SourceTotals | undefined;
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

  return c.json(
    {
      schemaVersion: '2',
      generatedAt,
      sources,
      total: [...counts.values()].reduce((sum, source) => sum + source.count, 0),
      available: true,
      samplesAvailable,
      uncataloguedSources: [...counts.keys()].filter((id) => !catalogIds.has(id)).sort(),
    },
    200,
    { 'Cache-Control': 'public, max-age=60, s-maxage=3600' }
  );
});

/**
 * GET /data/sources/:id — paginated raw events for one source family, newest
 * first. Powers the /data/[source] drill-in ("click on data to view it").
 * Matches the family and any `family:variant` sub-source (e.g. legistar:phoenix).
 */
dataRoute.get('/sources/:id', async (c) => {
  const id = c.req.param('id');
  const requestedLimit = Number(c.req.query('limit') ?? 50);
  const requestedOffset = Number(c.req.query('offset') ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 200);
  const offset = Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0);
  const date = c.req.query('date');
  if (date !== undefined && dayRange(date) === null) {
    return c.json({ error: 'invalid_date', expected: 'YYYY-MM-DD' }, 400);
  }
  const database = db(c.env.DB);
  const match = sourceMatch(id);
  const range = dayRange(date);
  const where = range
    ? and(
        match,
        gte(schema.events.publishedAt, range.start),
        lt(schema.events.publishedAt, range.end)
      )
    : match;

  let total = 0;
  let latestObservedAt = 0;
  let lastIngestedAt = 0;
  let futureCount = 0;
  try {
    // Unfiltered totals come from the cron-maintained rollup (at most 30
    // minutes behind); a `?date=` request still asks `events` directly,
    // because the rollup carries no per-day breakdown.
    const row =
      range === null && (await eventsRollupIsReady(database))
        ? await readSourceTotalsFromRollup(database, id)
        : await readSourceTotalsLive(database, where);
    total = Number(row?.n ?? 0);
    latestObservedAt = Number(row?.latestObservedAt ?? 0);
    lastIngestedAt = Number(row?.lastIngestedAt ?? 0);
    futureCount = Number(row?.futureCount ?? 0);
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
      available: false,
    });
  }

  const rows = await database
    .select({
      title: schema.events.title,
      content: schema.events.content,
      url: schema.events.sourceUrl,
      source: schema.events.source,
      entity: schema.events.primaryEntityId,
      publishedAt: schema.events.publishedAt,
    })
    .from(schema.events)
    .where(where)
    .orderBy(desc(schema.events.publishedAt))
    .limit(limit)
    .offset(offset);

  const events = rows.map((r) => ({
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

  return c.json({
    id,
    date: range ? date : undefined,
    total,
    latestObservedAt,
    lastIngestedAt,
    futureCount,
    events,
    hasMore: offset + events.length < total,
    available: true,
  });
});
