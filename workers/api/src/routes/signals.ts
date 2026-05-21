import { Hono } from "hono";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db";

type Env = { DB: D1Database };

export const signalsRoute = new Hono<{ Bindings: Env }>();

const notBackfill = () => sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`;

signalsRoute.get("/", async (c) => {
  const status = c.req.query("status") ?? "published";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const type = c.req.query("type");
  const direction = c.req.query("direction");
  const confidence = c.req.query("confidence");
  const entity = c.req.query("entity");

  const conditions: SQL[] = [
    eq(schema.signals.reviewStatus, status as "draft" | "published" | "corrected"),
  ];
  if (status === "published") conditions.push(notBackfill());
  if (type) conditions.push(eq(schema.signals.signalType, type));
  if (direction) conditions.push(eq(schema.signals.direction, direction as "up" | "down" | "neutral"));
  if (confidence) conditions.push(eq(schema.signals.confidence, confidence as "low" | "medium" | "high"));
  if (entity) conditions.push(eq(schema.signals.primaryEntityId, entity));

  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(...conditions))
    .orderBy(desc(schema.signals.publishedAt))
    .limit(limit);
  return c.json({ signals: rows });
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
  return c.json({
    types: types.results ?? [],
    directions: dirs.results ?? [],
    confidences: confs.results ?? [],
    topEntities: entities.results ?? [],
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
  const evid = await db(c.env.DB)
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.signalId, row.id));
  const scores = await db(c.env.DB)
    .select()
    .from(schema.scoreRuns)
    .where(eq(schema.scoreRuns.signalId, row.id));
  return c.json({ signal: row, evidence: evid, scores });
});

signalsRoute.get("/by-entity/:entityId", async (c) => {
  const entityId = c.req.param("entityId");
  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(eq(schema.signals.primaryEntityId, entityId), notBackfill()))
    .orderBy(desc(schema.signals.publishedAt));
  return c.json({ signals: rows });
});
