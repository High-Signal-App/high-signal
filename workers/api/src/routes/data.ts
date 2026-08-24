import { Hono } from 'hono';
import { and, desc, eq, gte, inArray, like, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { enrichSignal } from '../lib/signal-quality';
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

// Collapse `legistar:phoenix` / `macro-rates:fred:dgs10` to the catalog family.
function family(source: string): string {
  if (source.startsWith('edgar_')) return 'edgar';
  if (source.startsWith('china-news:') || source.startsWith('news:china-news-'))
    return 'china-news';
  if (source.startsWith('scmp:') || source.startsWith('news:scmp-')) return 'scmp';
  const first = (source || 'unknown').split(':', 1)[0]!;
  return SOURCE_FAMILY_ALIASES[first] ?? first;
}

function sourceMatch(id: string) {
  if (id === 'china-news') {
    return or(
      like(schema.events.source, 'china-news:%'),
      like(schema.events.source, 'news:china-news-%')
    );
  }
  if (id === 'scmp') {
    return or(like(schema.events.source, 'scmp:%'), like(schema.events.source, 'news:scmp-%'));
  }
  const aliases = SOURCE_QUERY_ALIASES[id] ?? [id];
  const conditions = aliases.flatMap((alias) => [
    eq(schema.events.source, alias),
    like(schema.events.source, `${alias}:%`),
    sql`${schema.events.source} GLOB ${`${alias}_*`}`,
  ]);
  return or(...conditions);
}

function dayRange(date: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

interface Sample {
  title: string | null;
  url: string;
  publishedAt: number;
}

export function resolveDailyDate(value: string | undefined, now = new Date()): string | null {
  if (value === undefined) return now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
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
 * GET /data/daily — complete public dump of one UTC day's published signals
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

  const signals = rows.map(enrichSignal).filter((signal) => signal.publishable);

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
  const isToday = date === new Date().toISOString().slice(0, 10);
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
      signalCount: signals.length,
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
 * GET /data/sources — live per-source data availability from the events store.
 * Powers the data-explore page: counts + most-recent samples per source family,
 * merged client-side with the static source catalog (storage/history/role).
 */
dataRoute.get('/sources', async (c) => {
  const limit = Math.min(Number(c.req.query('samples') ?? 4), 10);
  const database = db(c.env.DB);

  // Aggregate counts + last-seen per source (grouped in SQL).
  let rows: { source: string; n: number; last: number }[] = [];
  try {
    rows = (await database
      .select({
        source: schema.events.source,
        n: sql<number>`count(*)`,
        last: sql<number>`max(${schema.events.publishedAt})`,
      })
      .from(schema.events)
      .groupBy(schema.events.source)) as { source: string; n: number; last: number }[];
  } catch {
    return c.json({ sources: [], total: 0, available: false });
  }

  // Pull a recent slice once and bucket samples by family (cheaper than N queries).
  const recent = await database
    .select({
      source: schema.events.source,
      title: schema.events.title,
      url: schema.events.sourceUrl,
      publishedAt: schema.events.publishedAt,
    })
    .from(schema.events)
    .orderBy(desc(schema.events.publishedAt))
    .limit(1200);

  const counts = new Map<string, { count: number; lastAt: number }>();
  for (const r of rows) {
    const fam = family(r.source);
    const cur = counts.get(fam) ?? { count: 0, lastAt: 0 };
    cur.count += Number(r.n) || 0;
    cur.lastAt = Math.max(cur.lastAt, Number(r.last) || 0);
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
        publishedAt:
          r.publishedAt instanceof Date
            ? Math.floor(r.publishedAt.getTime() / 1000)
            : Number(r.publishedAt),
      });
      samples.set(fam, arr);
    }
  }

  const sources = [...counts.entries()]
    .map(([id, v]) => ({
      id,
      count: v.count,
      lastAt: v.lastAt,
      samples: samples.get(id) ?? [],
    }))
    .sort((a, b) => b.count - a.count);

  return c.json({
    sources,
    total: sources.reduce((s, x) => s + x.count, 0),
    available: true,
  });
});

/**
 * GET /data/sources/:id — paginated raw events for one source family, newest
 * first. Powers the /data/[source] drill-in ("click on data to view it").
 * Matches the family and any `family:variant` sub-source (e.g. legistar:phoenix).
 */
dataRoute.get('/sources/:id', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const date = c.req.query('date');
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
  try {
    const [row] = await database
      .select({ n: sql<number>`count(*)` })
      .from(schema.events)
      .where(where);
    total = Number(row?.n ?? 0);
  } catch {
    return c.json({
      id,
      date: range ? date : undefined,
      total: 0,
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
    events,
    hasMore: offset + events.length < total,
    available: true,
  });
});
