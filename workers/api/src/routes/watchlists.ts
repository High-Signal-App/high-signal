// Plan 0010 — Watchlists routes. Clerk-fronted at the proxy layer; the worker
// trusts X-Clerk-User-Id (injected by the Next.js /api/watchlists proxy).

import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  composeImpactChain,
  type ComposeArgs,
  type RelationshipEdge,
  type SignalForWatch,
  type SuppressionKind,
  type SuppressionRule,
} from "@high-signal/shared";
import { db, schema } from "../db";
import { sha16 } from "../lib/ids";

type Env = { DB: D1Database };

export const watchlistsRoute = new Hono<{ Bindings: Env }>();

function userId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header("X-Clerk-User-Id") ?? null;
}

async function defaultWatchlistId(d1: D1Database, uid: string): Promise<string> {
  const [row] = await db(d1)
    .select({ id: schema.watchlists.id })
    .from(schema.watchlists)
    .where(and(eq(schema.watchlists.userId, uid), eq(schema.watchlists.name, "default")))
    .limit(1);
  if (row) return row.id;
  const id = await sha16(`wl:${uid}:default`);
  await db(d1)
    .insert(schema.watchlists)
    .values({ id, userId: uid, name: "default", createdAt: new Date() })
    .onConflictDoNothing({ target: [schema.watchlists.userId, schema.watchlists.name] });
  return id;
}

// Resolve the path :id param to a watchlist row that belongs to `uid`. Returns
// null if the watchlist does not exist OR belongs to another user. The "default"
// alias falls back to lazy-creating the user's default list.
async function resolveOwnedWatchlistId(
  d1: D1Database,
  uid: string,
  paramId: string,
): Promise<string | null> {
  if (paramId === "default") return defaultWatchlistId(d1, uid);
  const [row] = await db(d1)
    .select({ id: schema.watchlists.id })
    .from(schema.watchlists)
    .where(and(eq(schema.watchlists.id, paramId), eq(schema.watchlists.userId, uid)))
    .limit(1);
  return row?.id ?? null;
}

watchlistsRoute.get("/", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const wls = await db(c.env.DB)
    .select()
    .from(schema.watchlists)
    .where(eq(schema.watchlists.userId, uid));
  return c.json({ watchlists: wls });
});

watchlistsRoute.post("/", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json()) as { name?: string };
  const name = body.name?.trim() || "default";
  const id = await sha16(`wl:${uid}:${name}`);
  await db(c.env.DB)
    .insert(schema.watchlists)
    .values({ id, userId: uid, name, createdAt: new Date() })
    .onConflictDoNothing({ target: [schema.watchlists.userId, schema.watchlists.name] });
  return c.json({ id, name });
});

watchlistsRoute.post("/:id/entities", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json()) as { entityId: string; horizon?: "day" | "week" | "month"; note?: string };
  if (!body.entityId) return c.json({ error: "missing_entity" }, 400);
  const rowId = await sha16(`we:${id}:${body.entityId}`);
  await db(c.env.DB)
    .insert(schema.watchlistEntities)
    .values({
      id: rowId,
      watchlistId: id,
      entityId: body.entityId,
      horizon: body.horizon ?? "week",
      addedAt: new Date(),
      note: body.note ?? null,
    })
    .onConflictDoNothing({ target: [schema.watchlistEntities.watchlistId, schema.watchlistEntities.entityId] });
  return c.json({ id: rowId });
});

watchlistsRoute.delete("/:id/entities/:entityId", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const entityId = c.req.param("entityId");
  await db(c.env.DB)
    .delete(schema.watchlistEntities)
    .where(
      and(
        eq(schema.watchlistEntities.watchlistId, id),
        eq(schema.watchlistEntities.entityId, entityId),
      ),
    );
  return c.json({ ok: true });
});

watchlistsRoute.post("/:id/suppressions", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json()) as { kind: SuppressionKind; value: string };
  if (!body.kind || !body.value) return c.json({ error: "missing_kind_or_value" }, 400);
  const rowId = await sha16(`sup:${id}:${body.kind}:${body.value}:${Date.now()}`);
  await db(c.env.DB)
    .insert(schema.watchlistSuppressions)
    .values({
      id: rowId,
      watchlistId: id,
      kind: body.kind,
      value: body.value,
      createdAt: new Date(),
    });
  return c.json({ id: rowId });
});

watchlistsRoute.delete("/:id/suppressions/:ruleId", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const ruleId = c.req.param("ruleId");
  await db(c.env.DB)
    .delete(schema.watchlistSuppressions)
    .where(
      and(
        eq(schema.watchlistSuppressions.id, ruleId),
        eq(schema.watchlistSuppressions.watchlistId, id),
      ),
    );
  return c.json({ ok: true });
});

watchlistsRoute.get("/:id/entities", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const rows = await db(c.env.DB)
    .select()
    .from(schema.watchlistEntities)
    .where(eq(schema.watchlistEntities.watchlistId, id))
    .orderBy(desc(schema.watchlistEntities.addedAt));
  return c.json({ entities: rows });
});

watchlistsRoute.get("/:id/suppressions", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const rows = await db(c.env.DB)
    .select()
    .from(schema.watchlistSuppressions)
    .where(eq(schema.watchlistSuppressions.watchlistId, id))
    .orderBy(desc(schema.watchlistSuppressions.createdAt));
  return c.json({ suppressions: rows });
});

watchlistsRoute.get("/:id/impact", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveOwnedWatchlistId(c.env.DB, uid, c.req.param("id"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const watching = await db(c.env.DB)
    .select()
    .from(schema.watchlistEntities)
    .where(eq(schema.watchlistEntities.watchlistId, id));
  const watchedIds = watching.map((w) => w.entityId);
  if (watchedIds.length === 0) return c.json({ items: [] });

  const since = new Date(Date.now() - 28 * 24 * 3600 * 1000);
  const directRows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, "published"),
        inArray(schema.signals.primaryEntityId, watchedIds),
      ),
    )
    .orderBy(desc(schema.signals.publishedAt))
    .limit(50);

  const edges = await db(c.env.DB)
    .select()
    .from(schema.relationships)
    .where(inArray(schema.relationships.fromEntityId, watchedIds));
  const secondaryIds = Array.from(new Set(edges.map((e) => e.toEntityId)));

  let secondaryRows: typeof directRows = [];
  if (secondaryIds.length > 0) {
    secondaryRows = await db(c.env.DB)
      .select()
      .from(schema.signals)
      .where(
        and(
          eq(schema.signals.reviewStatus, "published"),
          inArray(schema.signals.primaryEntityId, secondaryIds),
        ),
      )
      .orderBy(desc(schema.signals.publishedAt))
      .limit(100);
  }

  const sups = await db(c.env.DB)
    .select()
    .from(schema.watchlistSuppressions)
    .where(eq(schema.watchlistSuppressions.watchlistId, id));

  const surfaced = await db(c.env.DB)
    .select({ signalId: schema.watchlistDeltaLog.signalId })
    .from(schema.watchlistDeltaLog)
    .where(
      and(
        eq(schema.watchlistDeltaLog.userId, uid),
        eq(schema.watchlistDeltaLog.watchlistId, id),
      ),
    );

  const composed = composeImpactChain(buildComposeArgs(
    watchedIds,
    directRows,
    edges,
    secondaryRows,
    sups,
    surfaced.map((s) => s.signalId),
    since,
  ));

  // Log surfaced deltas. Best-effort; failures here don't block the response.
  try {
    for (const item of composed.slice(0, 20)) {
      await db(c.env.DB)
        .insert(schema.watchlistDeltaLog)
        .values({
          id: await sha16(`delta:${uid}:${id}:${item.signalId}`),
          userId: uid,
          watchlistId: id,
          entityId: item.subjectEntityId,
          signalId: item.signalId,
          deltaKind: item.deltaKind,
          surfacedAt: new Date(),
        })
        .onConflictDoNothing({ target: schema.watchlistDeltaLog.id });
    }
  } catch {
    /* swallow */
  }

  return c.json({ items: composed });
});

function buildComposeArgs(
  watchedIds: string[],
  directRows: Array<typeof schema.signals.$inferSelect>,
  edges: Array<typeof schema.relationships.$inferSelect>,
  secondaryRows: Array<typeof schema.signals.$inferSelect>,
  sups: Array<typeof schema.watchlistSuppressions.$inferSelect>,
  alreadySurfacedIds: string[],
  _since: Date,
): ComposeArgs {
  const toSignal = (r: typeof schema.signals.$inferSelect): SignalForWatch => ({
    id: r.id,
    slug: r.slug,
    signalType: r.signalType,
    primaryEntityId: r.primaryEntityId,
    confidence: r.confidence,
    publishedAt: r.publishedAt.toISOString(),
  });
  const toEdge = (e: typeof schema.relationships.$inferSelect): RelationshipEdge => ({
    fromEntityId: e.fromEntityId,
    toEntityId: e.toEntityId,
    type: e.type,
    weight: e.weight ?? 1,
    verified: Boolean(e.verified),
  });
  const toRule = (
    s: typeof schema.watchlistSuppressions.$inferSelect,
  ): SuppressionRule => ({
    kind: s.kind,
    value: s.value,
  });
  return {
    watchedEntityIds: watchedIds,
    directSignals: directRows.map(toSignal),
    edges: edges.map(toEdge),
    secondOrderSignals: secondaryRows.map(toSignal),
    suppressions: sups.map(toRule),
    alreadySurfacedSignalIds: new Set(alreadySurfacedIds),
    nowMs: Date.now(),
  };
}
