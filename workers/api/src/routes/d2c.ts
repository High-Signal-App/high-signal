/**
 * India D2C Opportunity Pipeline API (plan 0013, Slice 3).
 *
 * GET /d2c/opportunities
 *   Returns the latest snapshot per niche + score deltas + verdict changes
 *   + aging assessment. Reads from `d2c_niches` + `d2c_niche_snapshots`.
 *   Falls back to seed-only briefs when D1 is empty (fresh deploy / not yet
 *   migrated) so the surface stays live.
 *
 * GET /d2c/opportunities/:slug
 *   Returns the full snapshot history for one niche (for a detail page).
 *
 * GET /d2c/agent-visibility
 *   Returns the latest agent-visibility overlay (Slice 4) — which brands AI
 *   assistants recommend and cite for each niche's category prompt. Falls
 *   back to `[]` when no overlay has been run yet.
 */

import { Hono } from "hono";
import { desc, eq, gte } from "drizzle-orm";
import {
  agentVisibilityGapScore,
  assessAging,
  buildAgentVisibilityPrompt,
  buildSnapshotRecord,
  composeD2COpportunityBrief,
  computeD2CDelta,
  computeD2CDeltas,
  D2C_NICHE_SEEDS,
  extractCitedUrls,
  extractRecommendedBrands,
  type D2CAgentVisibilityEntry,
  type D2CNicheDelta,
  type D2CNicheSnapshotRecord,
} from "@high-signal/shared";
import { db, schema } from "../db";
import { FREE_AI_DEFAULT_ENDPOINT, fetchChatCompletion } from "../lib/ai-client";

type Env = {
  DB: D1Database;
  HIGH_SIGNAL_AI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
  ADMIN_TOKEN?: string;
};

export const d2cRoute = new Hono<{ Bindings: Env }>();

const RECENT_SNAPSHOT_DAYS = 90;

interface AgentVisibilityRow {
  nicheSlug: string;
  platform: string;
  model: string;
  promptText: string;
  responseText: string;
  recommendedBrands: string[];
  citedUrls: string[];
  brandMentioned: boolean;
  gapScore: number | null;
  runDate: string;
}

function avRowToEntry(
  row: typeof schema.d2cAgentVisibility.$inferSelect & { nicheSlug: string },
): AgentVisibilityRow {
  return {
    nicheSlug: row.nicheSlug,
    platform: row.platform,
    model: row.model,
    promptText: row.promptText,
    responseText: row.responseText,
    recommendedBrands: Array.isArray(row.recommendedBrands)
      ? (row.recommendedBrands as string[])
      : [],
    citedUrls: Array.isArray(row.citedUrls) ? (row.citedUrls as string[]) : [],
    brandMentioned: row.brandMentioned,
    gapScore: row.gapScore,
    runDate: row.runDate instanceof Date
      ? row.runDate.toISOString()
      : new Date(row.runDate as unknown as number).toISOString(),
  };
}

/** Convert a D1 snapshot row into the shared `D2CNicheSnapshotRecord` shape. */
function rowToRecord(
  row: typeof schema.d2cNicheSnapshots.$inferSelect & {
    nicheSlug?: string | null;
  },
): D2CNicheSnapshotRecord {
  return {
    nicheSlug: row.nicheSlug ?? "",
    snapshotDate: row.snapshotDate instanceof Date
      ? row.snapshotDate.toISOString().slice(0, 10)
      : new Date(row.snapshotDate as unknown as number).toISOString().slice(0, 10),
    opportunityScore: row.opportunityScore,
    demandScore: row.demandScore,
    competitionScore: row.competitionScore,
    pricingScore: row.pricingScore,
    adSaturationScore: row.adSaturationScore,
    agentVisibilityScore: row.agentVisibilityScore,
    sourceDiversity: row.sourceDiversity,
    verdict: row.verdict,
    confidence: row.confidence,
    freshnessDate: row.freshnessDate,
  };
}

interface NicheWithLatest {
  slug: string;
  name: string;
  category: string;
  region: string;
  status: string;
  latest: D2CNicheSnapshotRecord | null;
  delta: D2CNicheDelta | null;
  aging: "aged-well" | "aged-poorly" | "stable" | "insufficient-history";
  brief: ReturnType<typeof composeD2COpportunityBrief> | null;
  agentVisibility: AgentVisibilityRow[];
}

/**
 * GET /d2c/opportunities — latest snapshot per niche + deltas + aging.
 * Falls back to seed-only briefs when D1 is empty.
 */
d2cRoute.get("/opportunities", async (c) => {
  const database = db(c.env.DB);
  const sinceMs = Date.now() - RECENT_SNAPSHOT_DAYS * 24 * 60 * 60 * 1000;
  const sinceDate = new Date(sinceMs);

  // Join niches to their snapshots, recent first. We pull the last 90 days so
  // the renderer can compute deltas + aging without a second round-trip.
  let rows: Array<typeof schema.d2cNicheSnapshots.$inferSelect & {
    nicheSlug: string;
    nicheName: string;
    nicheCategory: string;
    nicheRegion: string;
    nicheStatus: string;
  }> = [];
  try {
    rows = await database
      .select({
        id: schema.d2cNicheSnapshots.id,
        nicheId: schema.d2cNicheSnapshots.nicheId,
        snapshotDate: schema.d2cNicheSnapshots.snapshotDate,
        opportunityScore: schema.d2cNicheSnapshots.opportunityScore,
        demandScore: schema.d2cNicheSnapshots.demandScore,
        competitionScore: schema.d2cNicheSnapshots.competitionScore,
        pricingScore: schema.d2cNicheSnapshots.pricingScore,
        adSaturationScore: schema.d2cNicheSnapshots.adSaturationScore,
        agentVisibilityScore: schema.d2cNicheSnapshots.agentVisibilityScore,
        sourceDiversity: schema.d2cNicheSnapshots.sourceDiversity,
        verdict: schema.d2cNicheSnapshots.verdict,
        confidence: schema.d2cNicheSnapshots.confidence,
        evidenceJson: schema.d2cNicheSnapshots.evidenceJson,
        freshnessDate: schema.d2cNicheSnapshots.freshnessDate,
        notes: schema.d2cNicheSnapshots.notes,
        createdAt: schema.d2cNicheSnapshots.createdAt,
        nicheSlug: schema.d2cNiches.slug,
        nicheName: schema.d2cNiches.name,
        nicheCategory: schema.d2cNiches.category,
        nicheRegion: schema.d2cNiches.region,
        nicheStatus: schema.d2cNiches.status,
      })
      .from(schema.d2cNicheSnapshots)
      .innerJoin(schema.d2cNiches, eq(schema.d2cNiches.id, schema.d2cNicheSnapshots.nicheId))
      .where(gte(schema.d2cNicheSnapshots.snapshotDate, sinceDate))
      .orderBy(desc(schema.d2cNicheSnapshots.snapshotDate));
  } catch (error) {
    // Fresh deploy / migration not applied yet — fall back to seed-only.
    console.warn("[d2c] snapshot read failed, falling back to seed:", (error as Error).message);
  }

  // Pull the latest agent-visibility entries per niche (Slice 4). We fetch the
  // most recent run_date's entries — one row per (niche, platform).
  let avRows: Array<typeof schema.d2cAgentVisibility.$inferSelect & { nicheSlug: string }> = [];
  try {
    avRows = await database
      .select({
        id: schema.d2cAgentVisibility.id,
        nicheId: schema.d2cAgentVisibility.nicheId,
        platform: schema.d2cAgentVisibility.platform,
        model: schema.d2cAgentVisibility.model,
        promptText: schema.d2cAgentVisibility.promptText,
        responseText: schema.d2cAgentVisibility.responseText,
        recommendedBrands: schema.d2cAgentVisibility.recommendedBrands,
        citedUrls: schema.d2cAgentVisibility.citedUrls,
        brandMentioned: schema.d2cAgentVisibility.brandMentioned,
        gapScore: schema.d2cAgentVisibility.gapScore,
        runDate: schema.d2cAgentVisibility.runDate,
        createdAt: schema.d2cAgentVisibility.createdAt,
        nicheSlug: schema.d2cNiches.slug,
      })
      .from(schema.d2cAgentVisibility)
      .innerJoin(schema.d2cNiches, eq(schema.d2cNiches.id, schema.d2cAgentVisibility.nicheId))
      .orderBy(desc(schema.d2cAgentVisibility.runDate));
  } catch (error) {
    console.warn("[d2c] agent-visibility read failed:", (error as Error).message);
  }
  // Keep only the latest run's entries per niche.
  const avBySlug = new Map<string, AgentVisibilityRow[]>();
  let latestRunMs = 0;
  for (const row of avRows) {
    const runMs = row.runDate instanceof Date ? row.runDate.getTime() : new Date(row.runDate as unknown as number).getTime();
    if (runMs > latestRunMs) {
      latestRunMs = runMs;
      // Reset — only the latest run survives.
      avBySlug.clear();
    }
    if (runMs === latestRunMs) {
      const entry = avRowToEntry(row);
      const list = avBySlug.get(entry.nicheSlug) ?? [];
      list.push(entry);
      avBySlug.set(entry.nicheSlug, list);
    }
  }

  // Group snapshots by niche slug.
  const bySlug = new Map<string, D2CNicheSnapshotRecord[]>();
  const nicheMeta = new Map<string, { name: string; category: string; region: string; status: string }>();
  for (const row of rows) {
    const rec = rowToRecord(row);
    const list = bySlug.get(row.nicheSlug) ?? [];
    list.push(rec);
    bySlug.set(row.nicheSlug, list);
    nicheMeta.set(row.nicheSlug, {
      name: row.nicheName,
      category: row.nicheCategory,
      region: row.nicheRegion,
      status: row.nicheStatus,
    });
  }

  // Build the response: one entry per seed niche (so the renderer always has
  // 20 even on a fresh deploy). Niches with no D1 history get a seed-only
  // snapshot for today + a "new" delta.
  const out: NicheWithLatest[] = D2C_NICHE_SEEDS.map((seed) => {
    const history = (bySlug.get(seed.slug) ?? []).slice().sort((a, b) =>
      a.snapshotDate.localeCompare(b.snapshotDate),
    );
    const meta = nicheMeta.get(seed.slug);
    const agentVis = avBySlug.get(seed.slug) ?? [];
    if (history.length === 0) {
      // Seed-only fallback: synthesize a snapshot for today so the renderer
      // has something to show. Marked as "new" with no delta.
      const today = new Date().toISOString().slice(0, 10);
      const avGapSeed = agentVis.length > 0
        ? Math.max(...agentVis.map((a) => a.gapScore ?? 0))
        : null;
      const synthetic = buildSnapshotRecord(seed, null, today, avGapSeed);
      return {
        slug: seed.slug,
        name: meta?.name ?? seed.name,
        category: meta?.category ?? seed.category,
        region: meta?.region ?? seed.region,
        status: meta?.status ?? "active",
        latest: synthetic,
        delta: computeD2CDelta(synthetic, null),
        aging: "insufficient-history",
        brief: composeD2COpportunityBrief(seed, null, avGapSeed),
        agentVisibility: agentVis,
      };
    }
    const latest = history[history.length - 1]!;
    const deltas = computeD2CDeltas(history);
    const delta = deltas.find((d) => d.nicheSlug === seed.slug) ?? null;
    const aging = assessAging(latest, history);
    // Re-hydrate the brief from the latest snapshot's scores. If the
    // agent-visibility overlay has run, use its gap score (more current than
    // the weekly snapshot's agentVisibilityScore).
    const avGap = agentVis.length > 0
      ? Math.max(...agentVis.map((a) => a.gapScore ?? 0))
      : latest.agentVisibilityScore;
    const brief = composeD2COpportunityBrief(seed, {
      nicheSlug: seed.slug,
      demandScore: latest.demandScore,
      competitionScore: latest.competitionScore,
      pricingScore: latest.pricingScore,
      adSaturationScore: latest.adSaturationScore,
      agentVisibilityScore: avGap,
      evidence: [],
      freshnessDate: latest.freshnessDate,
    }, avGap);
    return {
      slug: seed.slug,
      name: meta?.name ?? seed.name,
      category: meta?.category ?? seed.category,
      region: meta?.region ?? seed.region,
      status: meta?.status ?? "active",
      latest,
      delta,
      aging,
      brief,
      agentVisibility: agentVis,
    };
  });

  return c.json({
    generatedAt: new Date().toISOString(),
    region: "south-asia",
    niches: out,
    source: rows.length > 0 ? "d1" : "seed-fallback",
  });
});

/**
 * GET /d2c/opportunities/:slug — full snapshot history for one niche.
 */
d2cRoute.get("/opportunities/:slug", async (c) => {
  const slug = c.req.param("slug");
  const seed = D2C_NICHE_SEEDS.find((s) => s.slug === slug);
  if (!seed) {
    return c.json({ error: "unknown_niche" }, 404);
  }
  const database = db(c.env.DB);
  let rows: Array<typeof schema.d2cNicheSnapshots.$inferSelect> = [];
  try {
    const nicheRow = await database
      .select({ id: schema.d2cNiches.id })
      .from(schema.d2cNiches)
      .where(eq(schema.d2cNiches.slug, slug))
      .limit(1);
    if (nicheRow.length > 0) {
      rows = await database
        .select()
        .from(schema.d2cNicheSnapshots)
        .where(eq(schema.d2cNicheSnapshots.nicheId, nicheRow[0]!.id))
        .orderBy(desc(schema.d2cNicheSnapshots.snapshotDate));
    }
  } catch (error) {
    console.warn("[d2c] niche history read failed:", (error as Error).message);
  }
  const history = rows.map((row) => rowToRecord({ ...row, nicheSlug: slug }));
  return c.json({
    slug,
    seed,
    history,
    deltas: computeD2CDeltas(history),
    brief: composeD2COpportunityBrief(seed, null),
  });
});

/**
 * GET /d2c/agent-visibility — Slice 4 overlay (which brands AI assistants
 * recommend and cite per niche). Returns `[]` until the overlay is run.
 */
d2cRoute.get("/agent-visibility", async (c) => {
  const database = db(c.env.DB);
  let rows: Array<typeof schema.d2cAgentVisibility.$inferSelect & { nicheSlug: string }> = [];
  try {
    rows = await database
      .select({
        id: schema.d2cAgentVisibility.id,
        nicheId: schema.d2cAgentVisibility.nicheId,
        platform: schema.d2cAgentVisibility.platform,
        model: schema.d2cAgentVisibility.model,
        promptText: schema.d2cAgentVisibility.promptText,
        responseText: schema.d2cAgentVisibility.responseText,
        recommendedBrands: schema.d2cAgentVisibility.recommendedBrands,
        citedUrls: schema.d2cAgentVisibility.citedUrls,
        brandMentioned: schema.d2cAgentVisibility.brandMentioned,
        gapScore: schema.d2cAgentVisibility.gapScore,
        runDate: schema.d2cAgentVisibility.runDate,
        createdAt: schema.d2cAgentVisibility.createdAt,
        nicheSlug: schema.d2cNiches.slug,
      })
      .from(schema.d2cAgentVisibility)
      .innerJoin(schema.d2cNiches, eq(schema.d2cNiches.id, schema.d2cAgentVisibility.nicheId))
      .orderBy(desc(schema.d2cAgentVisibility.runDate));
  } catch (error) {
    console.warn("[d2c] agent-visibility read failed:", (error as Error).message);
  }
  const entries: D2CAgentVisibilityEntry[] = rows.map((row) => ({
    nicheSlug: row.nicheSlug,
    platform: row.platform,
    model: row.model,
    promptText: row.promptText,
    responseText: row.responseText,
    recommendedBrands: Array.isArray(row.recommendedBrands) ? (row.recommendedBrands as string[]) : [],
    citedUrls: Array.isArray(row.citedUrls) ? (row.citedUrls as string[]) : [],
    brandMentioned: row.brandMentioned,
    gapScore: row.gapScore ?? 0,
    runDate: row.runDate instanceof Date
      ? row.runDate.toISOString()
      : new Date(row.runDate as unknown as number).toISOString(),
  }));
  return c.json({
    generatedAt: new Date().toISOString(),
    entries,
    source: rows.length > 0 ? "d1" : "not-run-yet",
  });
});

/**
 * POST /d2c/agent-visibility/run — run the agent-visibility overlay server-side
 * using the worker's bound AI key. Admin-gated via ADMIN_TOKEN. Returns the
 * freshly-computed entries (does NOT persist to D1 — the caller can sync via
 * `scripts/sync-d2c-agent-visibility.ts` after saving the JSON).
 *
 * Body: { "limit": 20 } (optional, defaults to all 20 niches)
 */
d2cRoute.post("/agent-visibility/run", async (c) => {
  const token = c.env.ADMIN_TOKEN;
  const authHeader = c.req.header("Authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || provided !== token) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const apiKey = c.env.HIGH_SIGNAL_AI_API_KEY || c.env.OPENAI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "AI endpoint not configured. Set HIGH_SIGNAL_AI_API_KEY or OPENAI_API_KEY." }, 503);
  }
  const model = c.env.HIGH_SIGNAL_AI_MODEL || "auto";
  const endpointUrl = c.env.HIGH_SIGNAL_AI_ENDPOINT_URL || FREE_AI_DEFAULT_ENDPOINT;
  let limit = 20;
  try {
    const body = await c.req.json<{ limit?: number }>();
    if (typeof body.limit === "number" && body.limit > 0) limit = Math.min(body.limit, 20);
  } catch {
    // empty body is fine
  }

  const seeds = D2C_NICHE_SEEDS.slice(0, limit);
  const systemPrompt =
    "You are a helpful assistant. Answer the question directly with a numbered list of 3-5 brand options, each with a one-line reason. Cite any sources you rely on as URLs. If you don't know of specific brands, say so honestly rather than inventing names.";
  const runDate = new Date().toISOString();

  const entries: D2CAgentVisibilityEntry[] = [];
  for (const seed of seeds) {
    const userPrompt = buildAgentVisibilityPrompt(seed);
    let responseText = "";
    try {
      const aiRes = await fetchChatCompletion({
        config: { endpointUrl, apiKey, model },
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt,
        maxTokens: 600,
        stream: false,
        headers: { "X-Gateway-Project-Id": "high-signal" },
      });
      if (aiRes.ok) {
        const data = await aiRes.json() as { choices?: Array<{ message?: { content?: string } }> };
        responseText = data.choices?.[0]?.message?.content ?? "";
      } else {
        console.warn(`[d2c:av-run] AI call failed for ${seed.slug}: ${aiRes.status}`);
      }
    } catch (error) {
      console.warn(`[d2c:av-run] AI call threw for ${seed.slug}:`, (error as Error).message);
    }
    const brands = extractRecommendedBrands(responseText);
    const urls = extractCitedUrls(responseText);
    entries.push({
      nicheSlug: seed.slug,
      platform: "free-ai-gateway",
      model,
      promptText: userPrompt,
      responseText,
      recommendedBrands: brands,
      citedUrls: urls,
      brandMentioned: brands.length > 0,
      gapScore: agentVisibilityGapScore(brands),
      runDate,
    });
  }

  return c.json({
    generatedAt: runDate,
    region: "IN",
    entries,
    source: "live-run",
  });
});
