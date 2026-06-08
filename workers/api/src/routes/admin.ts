/**
 * Admin write routes — bearer-token auth via env.ADMIN_TOKEN.
 *
 * Modal scorer POSTs forward-return rows to /admin/scores.
 * CI / local sync-signals.ts POSTs frontmatter+body to /admin/sync to keep D1 in step with the git-versioned signals/ tree.
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

type Env = { DB: D1Database; ADMIN_TOKEN?: string };

export const adminRoute = new Hono<{ Bindings: Env }>();

adminRoute.use("*", async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return c.json({ error: "admin_disabled" }, 503);
  const auth = c.req.header("Authorization") ?? "";
  if (auth !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

interface ScoreRunInput {
  signalId: string;
  windowDays: number;
  forwardReturn: number | null;
  outcome: "hit" | "miss" | "push" | "pending";
  notes?: string;
}

adminRoute.post("/scores", async (c) => {
  const body = (await c.req.json()) as { runs?: ScoreRunInput[] };
  const runs = body.runs ?? [];
  if (!Array.isArray(runs)) return c.json({ error: "bad_payload" }, 400);

  const inserted: string[] = [];
  for (const r of runs) {
    if (!r.signalId || typeof r.windowDays !== "number" || !r.outcome) continue;
    const id = await sha16(`${r.signalId}:${r.windowDays}:${Date.now()}:${Math.random()}`);
    await db(c.env.DB)
      .insert(schema.scoreRuns)
      .values({
        id,
        signalId: r.signalId,
        runAt: new Date(),
        windowDays: r.windowDays,
        forwardReturn: r.forwardReturn,
        outcome: r.outcome,
        notes: r.notes ?? null,
      });
    inserted.push(id);
  }
  return c.json({ inserted: inserted.length, ids: inserted });
});

interface SignalUpsert {
  slug: string;
  signalType: string;
  primaryEntityId: string;
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
  predictedWindowDays: number;
  publishedAt: string; // ISO
  evidenceUrls: string[];
  spilloverEntityIds?: string[];
  reviewStatus?: "draft" | "published" | "corrected" | "killed";
  supersedesSignalId?: string | null;
  bodyMd: string;
}

adminRoute.post("/sync", async (c) => {
  const body = (await c.req.json()) as { signals?: SignalUpsert[] };
  const sigs = body.signals ?? [];
  let upserts = 0;
  let createdEntities = 0;
  for (const s of sigs) {
    const id = await sha16(s.slug);

    // Auto-upsert missing entities so the LLM picking up novel names
    // (DEEPSEEK, ASUSTEK, etc.) doesn't kill the whole batch on FK violation.
    const created = await ensureEntities(
      c.env.DB,
      [s.primaryEntityId, ...(s.spilloverEntityIds ?? [])],
    );
    createdEntities += created;

    // Auto-publish normal ingest, but preserve explicit drafts for fallback
    // candidates that need review before entering the public feed.
    const reviewStatus =
      s.reviewStatus === "draft" || s.reviewStatus === "corrected"
        ? s.reviewStatus
        : "published";

    try {
      await db(c.env.DB)
        .insert(schema.signals)
        .values({
          id,
          slug: s.slug,
          signalType: s.signalType,
          primaryEntityId: s.primaryEntityId,
          direction: s.direction,
          confidence: s.confidence,
          predictedWindowDays: s.predictedWindowDays,
          publishedAt: new Date(s.publishedAt),
          evidenceUrls: s.evidenceUrls,
          spilloverEntityIds: s.spilloverEntityIds ?? [],
          reviewStatus,
          supersedesSignalId: s.supersedesSignalId ?? null,
          bodyMd: s.bodyMd,
        })
        .onConflictDoUpdate({
          target: schema.signals.slug,
          set: {
            signalType: s.signalType,
            direction: s.direction,
            confidence: s.confidence,
            predictedWindowDays: s.predictedWindowDays,
            publishedAt: new Date(s.publishedAt),
            evidenceUrls: s.evidenceUrls,
            spilloverEntityIds: s.spilloverEntityIds ?? [],
            reviewStatus,
            supersedesSignalId: s.supersedesSignalId ?? null,
            bodyMd: s.bodyMd,
          },
        });
    } catch (err) {
      console.error("[admin/sync] insert failed", s.slug, String(err));
      continue;
    }

    // Replace evidence rows
    await db(c.env.DB).delete(schema.evidence).where(eq(schema.evidence.signalId, id));
    for (const url of s.evidenceUrls) {
      await db(c.env.DB)
        .insert(schema.evidence)
        .values({
          id: await sha16(`${id}:${url}`),
          signalId: id,
          url,
          sourceType: inferSourceType(url),
          excerpt: null,
          publishedAt: null,
        });
    }
    upserts++;
  }
  return c.json({ upserts, createdEntities });
});

async function ensureEntities(d1: D1Database, ids: (string | null | undefined)[]): Promise<number> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return 0;
  let created = 0;
  for (const id of unique) {
    const r = await db(d1)
      .insert(schema.entities)
      .values({
        id,
        ticker: null,
        name: id,
        type: "private",
        country: null,
        sector: null,
        metadata: { autoCreated: true, source: "admin/sync" },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: schema.entities.id })
      .returning({ id: schema.entities.id });
    if (r.length > 0) created++;
  }
  return created;
}

adminRoute.patch("/signals/:slug", async (c) => {
  const slug = c.req.param("slug");
  const body = (await c.req.json()) as {
    reviewStatus?: "draft" | "published" | "corrected" | "killed";
    supersedesSignalId?: string | null;
  };
  const updates: Record<string, unknown> = {};
  if (body.reviewStatus) updates["reviewStatus"] = body.reviewStatus;
  if ("supersedesSignalId" in body) updates["supersedesSignalId"] = body.supersedesSignalId;
  if (Object.keys(updates).length === 0) {
    return c.json({ error: "no_updates" }, 400);
  }
  const result = await db(c.env.DB)
    .update(schema.signals)
    .set(updates as Partial<typeof schema.signals.$inferInsert>)
    .where(eq(schema.signals.slug, slug))
    .returning({ id: schema.signals.id, slug: schema.signals.slug, reviewStatus: schema.signals.reviewStatus });
  if (result.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ updated: result[0] });
});

adminRoute.delete("/signals/:slug", async (c) => {
  const slug = c.req.param("slug");
  const [row] = await db(c.env.DB)
    .select({ id: schema.signals.id })
    .from(schema.signals)
    .where(eq(schema.signals.slug, slug))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  await db(c.env.DB).delete(schema.evidence).where(eq(schema.evidence.signalId, row.id));
  await db(c.env.DB).delete(schema.scoreRuns).where(eq(schema.scoreRuns.signalId, row.id));
  await db(c.env.DB).delete(schema.signals).where(eq(schema.signals.id, row.id));
  return c.json({ deleted: row.id });
});

// Audit ingest — bulk-insert raw events, llm_runs, ingest_runs from Modal.

export interface EventInput {
  source: string;
  sourceUrl: string;
  publishedAt: string;
  title?: string;
  content?: string;
  primaryEntityId?: string | null;
  rawHash: string;
  fetchRunId?: string | null;
  sourceDocument?: SourceDocumentInput | null;
}

export interface SourceDocumentInput {
  canonicalUrl?: string | null;
  documentKey?: string | null;
  fetchedAt?: string | null;
  publishedAt?: string | null;
  rawHash?: string | null;
  rawText?: string | null;
  rawJson?: unknown;
  parsedFields?: unknown;
}

adminRoute.post("/events", async (c) => {
  const body = (await c.req.json()) as { events?: EventInput[] };
  const events = body.events ?? [];
  let inserted = 0;
  for (const e of events) {
    const id = await sha16(e.rawHash);
    const sourceDocument = normalizeSourceDocument(e);
    const sourceDocumentId = await sha16(`source-document:${sourceDocument.documentKey}`);
    const sourceDocumentUpdate = {
      canonicalUrl: sourceDocument.canonicalUrl,
      fetchedAt: sourceDocument.fetchedAt,
      publishedAt: sourceDocument.publishedAt,
      rawHash: sourceDocument.rawHash,
      ...(sourceDocument.explicit
        ? {
            rawText: sourceDocument.rawText,
            rawJson: sourceDocument.rawJson,
            parsedFields: sourceDocument.parsedFields,
          }
        : {}),
    };
    try {
      await db(c.env.DB)
        .insert(schema.sourceDocuments)
        .values({
          id: sourceDocumentId,
          source: e.source,
          canonicalUrl: sourceDocument.canonicalUrl,
          documentKey: sourceDocument.documentKey,
          fetchedAt: sourceDocument.fetchedAt,
          publishedAt: sourceDocument.publishedAt,
          rawHash: sourceDocument.rawHash,
          rawText: sourceDocument.rawText,
          rawJson: sourceDocument.rawJson,
          parsedFields: sourceDocument.parsedFields,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sourceDocuments.documentKey,
          set: sourceDocumentUpdate,
        });
      await db(c.env.DB)
        .insert(schema.events)
        .values({
          id,
          source: e.source,
          sourceUrl: e.sourceUrl,
          publishedAt: new Date(e.publishedAt),
          title: e.title ?? null,
          content: e.content ?? null,
          primaryEntityId: e.primaryEntityId ?? null,
          rawHash: e.rawHash,
          sourceDocumentId,
          fetchRunId: e.fetchRunId ?? null,
        })
        .onConflictDoNothing({ target: schema.events.rawHash });
      inserted++;
    } catch {
      // ignore — dupe or FK miss; raw_hash unique guards the rest
    }
  }
  return c.json({ inserted });
});

export function normalizeSourceDocument(e: EventInput) {
  const doc = e.sourceDocument ?? {};
  const publishedAt = doc.publishedAt ?? e.publishedAt;
  const canonicalUrl = canonicalSourceUrl(doc.canonicalUrl ?? e.sourceUrl);
  return {
    explicit: e.sourceDocument != null,
    canonicalUrl,
    documentKey: doc.documentKey ?? sourceDocumentKey(e.source, canonicalUrl),
    fetchedAt: doc.fetchedAt ? new Date(doc.fetchedAt) : new Date(),
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    rawHash: doc.rawHash ?? e.rawHash,
    rawText: doc.rawText ?? e.content ?? null,
    rawJson: doc.rawJson ?? null,
    parsedFields: doc.parsedFields ?? {
      eventId: e.rawHash,
      sourceUrl: e.sourceUrl,
      title: e.title ?? null,
      primaryEntityId: e.primaryEntityId ?? null,
      fetchRunId: e.fetchRunId ?? null,
    },
  };
}

export function canonicalSourceUrl(value: string) {
  if (!value) return value;
  if (value.startsWith("/")) return value.trim();
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_|^ref$|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

export function sourceDocumentKey(source: string, canonicalUrl: string) {
  return `${source}:${canonicalUrl}`.toLowerCase();
}

interface LlmRunInput {
  signalSlug?: string | null;
  model: string;
  promptVersion?: string;
  accepted: boolean;
  reason?: string;
  requestJson: unknown;
  responseJson?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

adminRoute.post("/llm-runs", async (c) => {
  const body = (await c.req.json()) as { runs?: LlmRunInput[] };
  const runs = body.runs ?? [];
  for (const r of runs) {
    const id = await sha16(`llm:${r.signalSlug ?? ""}:${Date.now()}:${Math.random()}`);
    await db(c.env.DB).insert(schema.llmRuns).values({
      id,
      signalSlug: r.signalSlug ?? null,
      model: r.model,
      promptVersion: r.promptVersion ?? null,
      accepted: r.accepted,
      reason: r.reason ?? null,
      requestJson: r.requestJson,
      responseJson: r.responseJson ?? null,
      tokensIn: r.tokensIn ?? null,
      tokensOut: r.tokensOut ?? null,
      latencyMs: r.latencyMs ?? null,
      createdAt: new Date(),
    });
  }
  return c.json({ inserted: runs.length });
});

interface IngestRunInput {
  source: string;
  startedAt: string;
  finishedAt?: string;
  days?: number;
  eventsFetched?: number;
  eventsDroppedNoEntity?: number;
  eventsDroppedLowCluster?: number;
  signalsDrafted?: number;
  errors?: number;
  errorSample?: string;
  notes?: string;
}

adminRoute.post("/ingest-runs", async (c) => {
  const body = (await c.req.json()) as IngestRunInput;
  const id = await sha16(`run:${body.source}:${body.startedAt}:${Math.random()}`);
  await db(c.env.DB).insert(schema.ingestRuns).values({
    id,
    source: body.source,
    startedAt: new Date(body.startedAt),
    finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
    days: body.days ?? null,
    eventsFetched: body.eventsFetched ?? 0,
    eventsDroppedNoEntity: body.eventsDroppedNoEntity ?? 0,
    eventsDroppedLowCluster: body.eventsDroppedLowCluster ?? 0,
    signalsDrafted: body.signalsDrafted ?? 0,
    errors: body.errors ?? 0,
    errorSample: body.errorSample ?? null,
    notes: body.notes ?? null,
  });
  return c.json({ id });
});

interface QuoteInput {
  source: "polymarket" | "manifold" | "kalshi";
  marketId: string;
  entityId?: string | null;
  question: string;
  outcome: "yes" | "no" | "binary";
  prob: number;
  volume?: number | null;
  resolved?: boolean;
  resolvedOutcome?: string | null;
  marketUrl: string;
  fetchedAt: string; // ISO
}

adminRoute.post("/quotes", async (c) => {
  const body = (await c.req.json()) as { quotes?: QuoteInput[] };
  const quotes = body.quotes ?? [];
  if (!Array.isArray(quotes)) return c.json({ error: "bad_payload" }, 400);

  let inserted = 0;
  let skipped = 0;
  for (const q of quotes) {
    if (
      !q.source ||
      !q.marketId ||
      !q.question ||
      !q.outcome ||
      typeof q.prob !== "number" ||
      !q.marketUrl ||
      !q.fetchedAt
    ) {
      skipped++;
      continue;
    }
    const fetchedAt = new Date(q.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime())) {
      skipped++;
      continue;
    }
    // Idempotency: bucket fetchedAt to the hour so re-runs in the same window dedupe.
    const hourBucket = Math.floor(fetchedAt.getTime() / 3_600_000);
    const id = await sha16(`quote:${q.source}:${q.marketId}:${hourBucket}`);
    try {
      await db(c.env.DB)
        .insert(schema.marketQuotes)
        .values({
          id,
          source: q.source,
          marketId: q.marketId,
          entityId: q.entityId ?? null,
          question: q.question,
          outcome: q.outcome,
          prob: q.prob,
          volume: q.volume ?? null,
          resolved: q.resolved ?? false,
          resolvedOutcome: q.resolvedOutcome ?? null,
          fetchedAt,
          marketUrl: q.marketUrl,
        })
        .onConflictDoNothing({ target: schema.marketQuotes.id });
      inserted++;
    } catch (err) {
      console.error("[admin/quotes] insert failed", q.source, q.marketId, String(err));
      skipped++;
    }
  }
  return c.json({ inserted, skipped });
});

adminRoute.get("/audit/summary", async (c) => {
  const days = Number(c.req.query("days") ?? 7);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const events = (await c.env.DB.prepare(
    `SELECT source, count(*) as n FROM events WHERE ingested_at >= ? GROUP BY source ORDER BY n DESC`,
  )
    .bind(since)
    .all()) as { results: Array<{ source: string; n: number }> };

  const llm = (await c.env.DB.prepare(
    `SELECT model, accepted, count(*) as n, avg(latency_ms) as avg_ms
     FROM llm_runs WHERE created_at >= ? GROUP BY model, accepted`,
  )
    .bind(since)
    .all()) as {
    results: Array<{ model: string; accepted: number; n: number; avg_ms: number | null }>;
  };

  const runs = (await c.env.DB.prepare(
    `SELECT source, count(*) as n,
            sum(events_fetched) as fetched, sum(signals_drafted) as drafted,
            sum(errors) as errors
     FROM ingest_runs WHERE started_at >= ? GROUP BY source`,
  )
    .bind(since)
    .all()) as {
    results: Array<{
      source: string;
      n: number;
      fetched: number;
      drafted: number;
      errors: number;
    }>;
  };

  return c.json({
    sinceDays: days,
    eventsBySource: events.results ?? [],
    llmRuns: llm.results ?? [],
    ingestRuns: runs.results ?? [],
  });
});

adminRoute.get("/pending-scores", async (c) => {
  // Signals whose predicted window has elapsed and no score_run exists yet for that window.
  const rows = (await c.env.DB.prepare(
    `SELECT s.id, s.slug, s.primary_entity_id, s.direction, s.confidence, s.predicted_window_days, s.published_at
     FROM signals s
     WHERE s.review_status = 'published'
       AND (s.published_at + s.predicted_window_days * 86400) <= unixepoch()
       AND NOT EXISTS (
         SELECT 1 FROM score_runs sr
         WHERE sr.signal_id = s.id AND sr.window_days = s.predicted_window_days
       )
     LIMIT 200`,
  ).all()) as {
    results: Array<{
      id: string;
      slug: string;
      primary_entity_id: string;
      direction: string;
      confidence: string;
      predicted_window_days: number;
      published_at: number;
    }>;
  };
  return c.json({ pending: rows.results ?? [] });
});

async function sha16(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function inferSourceType(url: string): string {
  if (url.includes("sec.gov")) return "edgar";
  if (url.includes("reddit.com")) return "reddit";
  if (url.includes("github.com")) return "github";
  if (url.includes("twitter.com") || url.includes("x.com")) return "x";
  return "web";
}

// ─── /admin/backfill-entities ─────────────────────────────────────────────
// One-shot repair: re-runs the regex-word-boundary gazetteer match on events
// with primary_entity_id NULL that were ingested before the Python matcher
// was fixed to handle $TICKER. Mirrors python/.../extract/entities.py.

import { buildPatterns, matchEntity, type GazetteerEntity } from "../lib/gazetteer";

adminRoute.post("/backfill-entities", async (c) => {
  const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 7 * 24), 1), 90 * 24);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 2000), 1), 20000);
  const dryRun = c.req.query("dry_run") === "1";
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const entities = (await c.env.DB.prepare(
    "SELECT id, name, ticker, metadata FROM entities",
  ).all<GazetteerEntity>())
    .results ?? [];
  const patterns = buildPatterns(entities);

  const events = (await c.env.DB.prepare(
    `SELECT id, title, content
     FROM events
     WHERE primary_entity_id IS NULL
       AND published_at >= ?
     ORDER BY published_at DESC
     LIMIT ?`,
  )
    .bind(since, limit)
    .all<{ id: string; title: string | null; content: string | null }>())
    .results ?? [];

  const matches: Array<{ id: string; eid: string }> = [];
  for (const ev of events) {
    const haystack = `${ev.title ?? ""} ${ev.content ?? ""}`;
    const eid = matchEntity(haystack, patterns);
    if (eid) matches.push({ id: ev.id, eid });
  }

  if (!dryRun) {
    const stmts = matches.map((m) =>
      c.env.DB.prepare(
        "UPDATE events SET primary_entity_id = ? WHERE id = ? AND primary_entity_id IS NULL",
      ).bind(m.eid, m.id),
    );
    if (stmts.length > 0) {
      // D1 batch — single round-trip
      await c.env.DB.batch(stmts);
    }
  }

  return c.json({
    scannedEntities: entities.length,
    patternsCompiled: patterns.length,
    scannedEvents: events.length,
    matched: matches.length,
    stillNull: events.length - matches.length,
    dryRun,
  });
});
