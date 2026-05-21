import { Hono } from "hono";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { assessSignalQuality, type SignalContentCategory } from "@high-signal/shared";
import { db, schema } from "../db";

type Env = { DB: D1Database };

export const signalsRoute = new Hono<{ Bindings: Env }>();

const notBackfill = () => sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`;

function parseDateRange(c: { req: { query: (key: string) => string | undefined } }) {
  const date = c.req.query("date");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  return {
    start: start && Number.isFinite(start.getTime()) ? start : null,
    end: end && Number.isFinite(end.getTime()) ? end : null,
  };
}

function enrichSignal<T extends typeof schema.signals.$inferSelect>(signal: T) {
  const quality = assessSignalQuality({
    signalType: signal.signalType,
    primaryEntityId: signal.primaryEntityId,
    confidence: signal.confidence,
    evidenceUrls: (signal.evidenceUrls ?? []) as string[],
    bodyMd: signal.bodyMd,
  });
  return {
    ...signal,
    contentCategory: quality.contentCategory,
    qualityScore: quality.score,
    qualityBand: quality.band,
    publishable: quality.publishable,
    sourceClasses: quality.sourceClasses,
    independentSourceCount: quality.independentSourceCount,
    qualityReasons: quality.reasons,
  };
}

signalsRoute.get("/", async (c) => {
  const status = c.req.query("status") ?? "published";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const type = c.req.query("type");
  const direction = c.req.query("direction");
  const confidence = c.req.query("confidence");
  const entity = c.req.query("entity");
  const category = c.req.query("category") as SignalContentCategory | undefined;
  const minQuality = Number(c.req.query("minQuality") ?? 0);
  const includeWeak = c.req.query("includeWeak") === "1";
  const { start, end } = parseDateRange(c);

  const conditions: SQL[] = [
    eq(schema.signals.reviewStatus, status as "draft" | "published" | "corrected"),
  ];
  if (status === "published") conditions.push(notBackfill());
  if (type) conditions.push(eq(schema.signals.signalType, type));
  if (direction) conditions.push(eq(schema.signals.direction, direction as "up" | "down" | "neutral"));
  if (confidence) conditions.push(eq(schema.signals.confidence, confidence as "low" | "medium" | "high"));
  if (entity) conditions.push(eq(schema.signals.primaryEntityId, entity));
  if (start) conditions.push(gte(schema.signals.publishedAt, start));
  if (end) conditions.push(lt(schema.signals.publishedAt, end));

  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(...conditions))
    .orderBy(desc(schema.signals.publishedAt))
    .limit(category || minQuality ? Math.max(limit, 200) : limit);
  const enriched = rows
    .map(enrichSignal)
    .filter((signal) => status !== "published" || includeWeak || signal.publishable)
    .filter((signal) => !category || signal.contentCategory === category)
    .filter((signal) => !minQuality || signal.qualityScore >= minQuality)
    .slice(0, limit);
  return c.json({ signals: enriched });
});

signalsRoute.get("/facets", async (c) => {
  // Aggregate counts for filter chips
  const types = (await c.env.DB.prepare(
    `SELECT signal_type as k, count(*) as n FROM signals WHERE review_status='published' AND body_md NOT LIKE '> _backfill_%' GROUP BY signal_type ORDER BY n DESC`,
  ).all()) as { results: Array<{ k: string; n: number }> };
  const dirs = (await c.env.DB.prepare(
    `SELECT direction as k, count(*) as n FROM signals WHERE review_status='published' AND body_md NOT LIKE '> _backfill_%' GROUP BY direction`,
  ).all()) as { results: Array<{ k: string; n: number }> };
  const confs = (await c.env.DB.prepare(
    `SELECT confidence as k, count(*) as n FROM signals WHERE review_status='published' AND body_md NOT LIKE '> _backfill_%' GROUP BY confidence`,
  ).all()) as { results: Array<{ k: string; n: number }> };
  const entities = (await c.env.DB.prepare(
    `SELECT primary_entity_id as k, count(*) as n FROM signals WHERE review_status='published' AND body_md NOT LIKE '> _backfill_%' GROUP BY primary_entity_id ORDER BY n DESC LIMIT 20`,
  ).all()) as { results: Array<{ k: string; n: number }> };
  const recentRows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(eq(schema.signals.reviewStatus, "published"), notBackfill()))
    .orderBy(desc(schema.signals.publishedAt))
    .limit(500);
  const categoryCounts = new Map<string, number>();
  const sourceClassCounts = new Map<string, number>();
  for (const signal of recentRows.map(enrichSignal).filter((signal) => signal.publishable)) {
    categoryCounts.set(signal.contentCategory, (categoryCounts.get(signal.contentCategory) ?? 0) + 1);
    for (const sourceClass of signal.sourceClasses) {
      sourceClassCounts.set(sourceClass, (sourceClassCounts.get(sourceClass) ?? 0) + 1);
    }
  }
  const toFacet = (counts: Map<string, number>) =>
    Array.from(counts.entries())
      .map(([k, n]) => ({ k, n }))
      .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  return c.json({
    types: types.results ?? [],
    directions: dirs.results ?? [],
    confidences: confs.results ?? [],
    topEntities: entities.results ?? [],
    categories: toFacet(categoryCounts),
    sourceClasses: toFacet(sourceClassCounts),
  });
});

signalsRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const [row] = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.slug, slug))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.reviewStatus === "published" && row.bodyMd.trimStart().startsWith("> _backfill_")) {
    return c.json({ error: "not_found" }, 404);
  }
  const enrichedRow = enrichSignal(row);
  if (row.reviewStatus === "published" && !enrichedRow.publishable && c.req.query("includeWeak") !== "1") {
    return c.json({ error: "not_found" }, 404);
  }
  const evid = await db(c.env.DB)
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.signalId, row.id));
  const scores = await db(c.env.DB)
    .select()
    .from(schema.scoreRuns)
    .where(eq(schema.scoreRuns.signalId, row.id));
  return c.json({ signal: enrichedRow, evidence: evid, scores });
});

signalsRoute.get("/by-entity/:entityId", async (c) => {
  const entityId = c.req.param("entityId");
  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(eq(schema.signals.primaryEntityId, entityId), notBackfill()))
    .orderBy(desc(schema.signals.publishedAt));
  return c.json({ signals: rows.map(enrichSignal).filter((signal) => signal.publishable) });
});
