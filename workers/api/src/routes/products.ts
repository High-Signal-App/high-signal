import { Hono } from "hono";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { BADGE_WIDGET_JS } from "../lib/badge-widget";
import { sha16 } from "../lib/ids";
import { fetchChatCompletion, FREE_AI_DEFAULT_ENDPOINT } from "../lib/ai-client";
import type { AIConfig } from "../lib/ai-client";
import { generateCommunityDigest } from "../lib/community-research";
import { searchExternalMentions } from "../lib/external-monitors";
import { runMentionCheck } from "../lib/mention-execution";
import { executePromptsWithAI } from "../lib/agent-evaluation-execution";
import { runSeoAudit } from "../lib/seo-audit";
import {
  buildAgentEvaluationAudit,
  buildMonthlyCompetitorReport,
  buildVisibilityMatrix,
  classifyOwnership,
  computeShareOfVoice,
  computeTrends,
  COMMUNITY_INTENT_SOURCES,
  getSeedMonthlyCompetitorReport,
  hostOf,
  normalizeCommunitySummary,
  scoreIntentOpportunity,
  sortAttributes,
  type AttributeRow,
  type IntentOpportunityCandidate,
  type MatrixRow,
  type MentionRow,
} from "@high-signal/shared";
import type {
  AgentEvaluationAudit,
  AgentEvaluationAuditDetail,
  AgentEvaluationCompetitor,
  AIPlatform,
  CompetitorProfile,
  CommunityDigestSnapshot,
  CommunitySummary,
  EvidenceScoreStatus,
  AgentAuditStatus,
  AgentTaskPriority,
  AgentTaskStatus,
  MentionBrandConfig,
  MentionCheck,
  MentionPrompt,
  PersistedAgentPromptResult,
  PersistedEvidenceLayerScore,
  PersistedMissingEvidenceTask,
  PersistedReelBrief,
  ProductDashboardSnapshot,
  TrackedCommunity,
} from "@high-signal/shared";

type Env = {
  DB: D1Database;
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_API_KEY?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
  OPENAI_API_KEY?: string;
};
type NewConfigBody = Partial<{
  brandName: string;
  brandAliases: string[];
  brandUrl: string | null;
  competitors: CompetitorProfile[];
  platforms: AIPlatform[];
  aiEndpointUrl: string | null;
  aiModel: string | null;
  checkSchedule: "daily" | "weekly" | null;
  badgeEnabled: boolean;
}>;
type NewPromptBody = Partial<{ promptText: string; category: string | null }>;
type NewCommunityBody = Partial<{
  subreddit: string;
  prompt: string | null;
  period: "day" | "week" | "month";
  isPublic: boolean;
}>;
type NewDigestBody = Partial<{
  summaryText: string;
  summary: CommunitySummary | null;
  promptUsed: string;
  sourceCount: number;
  snapshotDate: string;
}>;
type NewAgentAuditBody = Partial<{
  brandName: string;
  brandUrl: string;
  buyerMission: string;
  targetSegment: string | null;
  competitors: AgentEvaluationCompetitor[];
  evidenceText: string | null;
  evidenceUrls: string[];
}>;
type IntentStatus = "open" | "dismissed" | "done";
type PatchIntentOpportunityBody = Partial<{ status: IntentStatus }>;

export const productsRoute = new Hono<{ Bindings: Env }>();

productsRoute.get("/dashboard", async (c) => {
  const ownerId = c.req.query("owner")?.trim();
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const database = db(c.env.DB);
  const [configs, prompts, recentChecks, tracked, latestDigests] = await Promise.all([
    database
      .select()
      .from(schema.mentionBrandConfigs)
      .where(eq(schema.mentionBrandConfigs.ownerId, ownerId))
      .orderBy(desc(schema.mentionBrandConfigs.updatedAt))
      .limit(10),
    database
      .select()
      .from(schema.mentionPrompts)
      .where(eq(schema.mentionPrompts.ownerId, ownerId))
      .orderBy(desc(schema.mentionPrompts.createdAt))
      .limit(50),
    database
      .select()
      .from(schema.mentionChecks)
      .where(eq(schema.mentionChecks.ownerId, ownerId))
      .orderBy(desc(schema.mentionChecks.createdAt))
      .limit(10),
    database
      .select()
      .from(schema.trackedCommunities)
      .where(eq(schema.trackedCommunities.ownerId, ownerId))
      .orderBy(desc(schema.trackedCommunities.updatedAt))
      .limit(25),
    database
      .select()
      .from(schema.communityDigestSnapshots)
      .where(eq(schema.communityDigestSnapshots.ownerId, ownerId))
      .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
      .limit(10),
  ]);

  return c.json(
    productDashboardSnapshot({
      ownerId,
      configs,
      prompts,
      recentChecks,
      tracked,
      latestDigests,
    }),
  );
});

/**
 * Live SEO/GEO audit of any URL. Public, no owner required — this is the
 * lens we point at customer brands AND at highsignal.app itself.
 *
 *   GET /products/agent-eval/seo-audit?url=https://example.com
 *
 * Cached 10 minutes per URL via CF edge headers.
 */
productsRoute.get("/agent-eval/seo-audit", async (c) => {
  const url = c.req.query("url")?.trim();
  if (!url) return c.json({ error: "missing_url" }, 400);
  if (!/^https?:\/\//i.test(url)) return c.json({ error: "invalid_url" }, 400);
  const report = await runSeoAudit(url);
  return c.json(report, 200, {
    "Cache-Control": "public, max-age=600, s-maxage=600",
  });
});

productsRoute.get("/agent-eval/audits", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const rows = await db(c.env.DB)
    .select()
    .from(schema.agentEvaluationAudits)
    .where(eq(schema.agentEvaluationAudits.ownerId, ownerId))
    .orderBy(desc(schema.agentEvaluationAudits.createdAt))
    .limit(clampedLimit(c.req.query("limit"), 10, 50));

  return c.json({ audits: rows.map(toAgentEvaluationAudit) });
});

productsRoute.post("/agent-eval/audits", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const body = await safeJson<NewAgentAuditBody>(c.req);
  const parsed = parseAgentAuditInput(ownerId, body);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const baseResult = buildAgentEvaluationAudit(parsed.input);
  const enrichedPrompts = await executePromptsWithAI({
    env: c.env,
    audit: parsed.input,
    prompts: baseResult.prompts,
  });
  const result = { ...baseResult, prompts: enrichedPrompts };
  const now = new Date();
  const auditId = crypto.randomUUID();
  const database = db(c.env.DB);

  const [audit] = await database
    .insert(schema.agentEvaluationAudits)
    .values({
      id: auditId,
      ownerId,
      brandName: parsed.input.brandName,
      brandUrl: parsed.input.brandUrl,
      buyerMission: parsed.input.buyerMission,
      targetSegment: parsed.input.targetSegment ?? null,
      competitors: parsed.input.competitors ?? [],
      status: "completed",
      overallScore: result.overallScore,
      recommendationSummary: result.recommendationSummary,
      evidenceText: parsed.input.evidenceText ?? null,
      evidenceUrls: parsed.input.evidenceUrls ?? [],
      createdAt: now,
      completedAt: now,
    })
    .returning();

  await database.insert(schema.agentEvaluationResponses).values(
    result.prompts.map((prompt) => ({
      id: crypto.randomUUID(),
      auditId,
      ownerId,
      promptKey: prompt.promptKey,
      promptText: prompt.promptText,
      surface: prompt.surface,
      responseText: prompt.responseText,
      brandMentioned: prompt.brandMentioned,
      brandRecommended: prompt.brandRecommended,
      competitorsMentioned: prompt.competitorsMentioned,
      citations: prompt.citations,
      createdAt: now,
    })),
  );
  await database.insert(schema.agentEvidenceScores).values(
    result.scores.map((score) => ({
      id: crypto.randomUUID(),
      auditId,
      ownerId,
      area: score.area,
      status: score.status,
      score: score.score,
      evidenceUrls: score.evidenceUrls,
      notes: score.notes,
      createdAt: now,
    })),
  );
  if (result.tasks.length) {
    await database.insert(schema.agentEvidenceTasks).values(
      result.tasks.map((task) => ({
        id: crypto.randomUUID(),
        auditId,
        ownerId,
        area: task.area,
        title: task.title,
        priority: task.priority,
        status: task.status,
        sourceUrl: task.sourceUrl ?? null,
        createdAt: now,
      })),
    );
  }
  await database.insert(schema.reelBriefs).values(
    result.reelBriefs.map((brief) => ({
      id: crypto.randomUUID(),
      auditId,
      ownerId,
      title: brief.title,
      hook: brief.hook,
      buyerMission: brief.buyerMission,
      proofPoints: brief.proofPoints,
      visualBeats: brief.visualBeats,
      caption: brief.caption,
      cta: brief.cta,
      claimBoundary: brief.claimBoundary,
      evidenceUrls: brief.evidenceUrls,
      createdAt: now,
    })),
  );

  return c.json(await loadAgentEvaluationAudit(c.env.DB, ownerId, audit.id), 201);
});

productsRoute.get("/agent-eval/audits/:id", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const detail = await loadAgentEvaluationAudit(c.env.DB, ownerId, c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

productsRoute.get("/mentions/configs", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const rows = await db(c.env.DB)
    .select()
    .from(schema.mentionBrandConfigs)
    .where(eq(schema.mentionBrandConfigs.ownerId, ownerId))
    .orderBy(desc(schema.mentionBrandConfigs.updatedAt));

  return c.json({ configs: rows.map(toMentionBrandConfig) });
});

productsRoute.post("/mentions/configs", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const body = await safeJson<NewConfigBody>(c.req);
  const parsed = parseBrandConfigInput(ownerId, body);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] = await db(c.env.DB)
    .insert(schema.mentionBrandConfigs)
    .values(parsed.values)
    .returning();

  return c.json({ config: toMentionBrandConfig(row) }, 201);
});

productsRoute.patch("/mentions/configs/:id", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const existing = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await safeJson<NewConfigBody>(c.req);
  const parsed = parseBrandConfigInput(ownerId, body, existing);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] = await db(c.env.DB)
    .update(schema.mentionBrandConfigs)
    .set({ ...parsed.values, id: existing.id, ownerId, updatedAt: new Date() })
    .where(eq(schema.mentionBrandConfigs.id, existing.id))
    .returning();

  return c.json({ config: toMentionBrandConfig(row) });
});

productsRoute.delete("/mentions/configs/:id", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const existing = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found" }, 404);

  const database = db(c.env.DB);
  await database
    .delete(schema.mentionResults)
    .where(eq(schema.mentionResults.configId, existing.id));
  await database.delete(schema.mentionChecks).where(eq(schema.mentionChecks.configId, existing.id));
  await database
    .delete(schema.mentionPrompts)
    .where(eq(schema.mentionPrompts.configId, existing.id));
  await database
    .delete(schema.mentionBrandConfigs)
    .where(eq(schema.mentionBrandConfigs.id, existing.id));
  return c.json({ ok: true });
});

productsRoute.get("/mentions/configs/:id/prompts", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const config = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!config) return c.json({ error: "not_found" }, 404);

  const rows = await db(c.env.DB)
    .select()
    .from(schema.mentionPrompts)
    .where(eq(schema.mentionPrompts.configId, config.id))
    .orderBy(desc(schema.mentionPrompts.createdAt));

  return c.json({ prompts: rows.map(toMentionPrompt) });
});

productsRoute.post("/mentions/configs/:id/prompts", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const config = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!config) return c.json({ error: "not_found" }, 404);

  const body = await safeJson<NewPromptBody>(c.req);
  const promptText = body.promptText?.trim();
  if (!promptText) return c.json({ error: "missing_prompt_text" }, 400);

  const [row] = await db(c.env.DB)
    .insert(schema.mentionPrompts)
    .values({
      id: crypto.randomUUID(),
      configId: config.id,
      ownerId,
      promptText,
      category: body.category?.trim() || null,
      createdAt: new Date(),
    })
    .returning();

  return c.json({ prompt: toMentionPrompt(row) }, 201);
});

productsRoute.delete("/mentions/prompts/:id", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);

  const [prompt] = await db(c.env.DB)
    .select()
    .from(schema.mentionPrompts)
    .where(and(eq(schema.mentionPrompts.ownerId, ownerId), eq(schema.mentionPrompts.id, c.req.param("id"))))
    .limit(1);
  if (!prompt) return c.json({ error: "not_found" }, 404);

  await db(c.env.DB).delete(schema.mentionPrompts).where(eq(schema.mentionPrompts.id, prompt.id));
  return c.json({ ok: true });
});

productsRoute.get("/mentions/configs/:id/checks", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const config = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!config) return c.json({ error: "not_found" }, 404);

  const rows = await db(c.env.DB)
    .select()
    .from(schema.mentionChecks)
    .where(eq(schema.mentionChecks.configId, config.id))
    .orderBy(desc(schema.mentionChecks.createdAt))
    .limit(25);

  return c.json({ checks: rows.map(toMentionCheck) });
});

productsRoute.post("/mentions/configs/:id/checks", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const config = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!config) return c.json({ error: "not_found" }, 404);

  const prompts = await db(c.env.DB)
    .select()
    .from(schema.mentionPrompts)
    .where(eq(schema.mentionPrompts.configId, config.id));
  if (prompts.length === 0) return c.json({ error: "missing_prompts" }, 400);

  const database = db(c.env.DB);
  const [row] = await database
    .insert(schema.mentionChecks)
    .values({
      id: crypto.randomUUID(),
      configId: config.id,
      ownerId,
      status: "running",
      totalQueries: prompts.length,
      completedQueries: 0,
      createdAt: new Date(),
    })
    .returning();

  c.executionCtx.waitUntil(
    runMentionCheck({
      database,
      env: c.env,
      config,
      prompts,
      checkId: row.id,
    })
      .then(() => refreshIntentOpportunitiesForBrand(database, ownerId, config, { windowDays: 14, limit: 50 }))
      .catch((error) => console.error("High Signal mention check / intent refresh failed:", error)),
  );

  return c.json({ check: toMentionCheck(row) }, 201);
});

productsRoute.get("/mentions/configs/:id/monitors", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const config = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!config) return c.json({ error: "not_found" }, 404);

  const results = await searchExternalMentions({
    brandName: config.brandName,
    aliases: stringArray(config.brandAliases),
    days: clampedLimit(c.req.query("days"), 30, 365),
  });
  return c.json(results);
});

productsRoute.get("/mentions/configs/:id/report", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const config = await getOwnedConfig(c.env.DB, ownerId, c.req.param("id"));
  if (!config) return c.json({ error: "not_found" }, 404);

  const [prompts, checks] = await Promise.all([
    db(c.env.DB).select().from(schema.mentionPrompts).where(eq(schema.mentionPrompts.configId, config.id)),
    db(c.env.DB)
      .select()
      .from(schema.mentionChecks)
      .where(eq(schema.mentionChecks.configId, config.id))
      .orderBy(desc(schema.mentionChecks.createdAt))
      .limit(5),
  ]);

  // Load results for the most recent check(s) to feed competitor report chatter.
  let recentResults: any[] = [];
  if (checks.length > 0) {
    const latestCheckIds = checks.slice(0, 2).map((c) => c.id);
    recentResults = await db(c.env.DB)
      .select()
      .from(schema.mentionResults)
      .where(eq(schema.mentionResults.checkId, latestCheckIds[0]));
  }

  const competitorReport = buildMonthlyCompetitorReport({
    brandName: config.brandName,
    competitors: objectArray<{ name?: string; url?: string }>(config.competitors || []).map((c) => c?.name || ""),
    mentionResults: recentResults.map((r) => ({
      responseText: r.responseText,
      platform: r.platform,
      createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
      competitorsMentioned: r.competitorsMentioned,
      citations: r.citations,
    })),
  });

  return c.json({
    report: {
      generatedAt: new Date().toISOString(),
      brand: toMentionBrandConfig(config),
      summary: {
        totalPrompts: prompts.length,
        totalChecks: checks.length,
        latestMentionRate: checks[0]?.brandMentionRate ?? null,
      },
      recentChecks: checks.map(toMentionCheck),
      competitorReport,
    },
  });
});

// Dedicated competitor report surface (seed fixture for public/demo verification + real path).
// GET /products/mentions/competitor-report?seed=linear  (public, uses fixed small seed set)
// GET /products/mentions/competitor-report?owner=...&config=...  (real data overlay from mentions)
productsRoute.get("/mentions/competitor-report", async (c) => {
  const seedId = c.req.query("seed")?.trim();
  if (seedId) {
    const report = getSeedMonthlyCompetitorReport(seedId);
    if (report) {
      return c.json({ report });
    }
    return c.json({ error: "unknown_seed_product" }, 404);
  }

  const ownerId = c.req.query("owner")?.trim();
  const configId = c.req.query("config")?.trim();
  if (ownerId && configId) {
    const config = await getOwnedConfig(c.env.DB, ownerId, configId);
    if (config) {
      // Pull recent results (up to last 2 checks) — mirrors the enriched config report path.
      const checks = await db(c.env.DB)
        .select()
        .from(schema.mentionChecks)
        .where(eq(schema.mentionChecks.configId, config.id))
        .orderBy(desc(schema.mentionChecks.createdAt))
        .limit(2);
      let recentResults: any[] = [];
      if (checks.length > 0) {
        recentResults = await db(c.env.DB)
          .select()
          .from(schema.mentionResults)
          .where(eq(schema.mentionResults.checkId, checks[0].id));
      }
      const report = buildMonthlyCompetitorReport({
        brandName: config.brandName,
        competitors: objectArray<{ name?: string; url?: string }>(config.competitors || []).map((c) => c?.name || ""),
        mentionResults: recentResults.map((r) => ({
          responseText: r.responseText,
          platform: r.platform,
          createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
          competitorsMentioned: r.competitorsMentioned,
          citations: r.citations,
        })),
      });
      return c.json({ report });
    }
    return c.json({ error: "not_found" }, 404);
  }

  // Default demo fixture (no auth) — satisfies "verify with a local route or data fixture".
  return c.json({ report: getSeedMonthlyCompetitorReport("linear") });
});

productsRoute.get("/badge/widget.js", () => {
  return new Response(BADGE_WIDGET_JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

productsRoute.get("/badge/:configId", async (c) => {
  const config = await getConfig(c.env.DB, c.req.param("configId"));
  if (!config) return c.json({ error: "not_found" }, 404);
  if (!config.badgeEnabled) return c.json({ error: "badge_disabled" }, 403);

  const [latestCheck] = await db(c.env.DB)
    .select()
    .from(schema.mentionChecks)
    .where(and(eq(schema.mentionChecks.configId, config.id), eq(schema.mentionChecks.status, "completed")))
    .orderBy(desc(schema.mentionChecks.createdAt))
    .limit(1);
  if (!latestCheck) return c.json({ error: "no_completed_checks" }, 404);

  const results = await db(c.env.DB)
    .select()
    .from(schema.mentionResults)
    .where(eq(schema.mentionResults.checkId, latestCheck.id));
  if (results.length === 0) return c.json({ error: "no_results" }, 404);

  const badge = visibilityBadge(toMentionBrandConfig(config), toMentionCheck(latestCheck), results);
  return c.json(badge, 200, {
    "Cache-Control": "public, max-age=3600, s-maxage=3600",
    "Access-Control-Allow-Origin": "*",
  });
});

productsRoute.get("/communities/tracked", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const rows = await db(c.env.DB)
    .select()
    .from(schema.trackedCommunities)
    .where(eq(schema.trackedCommunities.ownerId, ownerId))
    .orderBy(desc(schema.trackedCommunities.updatedAt));

  return c.json({ communities: rows.map(toTrackedCommunity) });
});

productsRoute.post("/communities/tracked", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const body = await safeJson<NewCommunityBody>(c.req);
  const parsed = parseTrackedCommunityInput(ownerId, body);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] = await db(c.env.DB).insert(schema.trackedCommunities).values(parsed.values).returning();
  return c.json({ community: toTrackedCommunity(row) }, 201);
});

productsRoute.patch("/communities/tracked/:id", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const existing = await getOwnedCommunity(c.env.DB, ownerId, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await safeJson<NewCommunityBody>(c.req);
  const parsed = parseTrackedCommunityInput(ownerId, body, existing);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const [row] = await db(c.env.DB)
    .update(schema.trackedCommunities)
    .set({ ...parsed.values, id: existing.id, ownerId, updatedAt: new Date() })
    .where(eq(schema.trackedCommunities.id, existing.id))
    .returning();
  return c.json({ community: toTrackedCommunity(row) });
});

productsRoute.delete("/communities/tracked/:id", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const existing = await getOwnedCommunity(c.env.DB, ownerId, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found" }, 404);

  const database = db(c.env.DB);
  await database
    .delete(schema.communityDigestSnapshots)
    .where(eq(schema.communityDigestSnapshots.trackedCommunityId, existing.id));
  await database.delete(schema.trackedCommunities).where(eq(schema.trackedCommunities.id, existing.id));
  return c.json({ ok: true });
});

productsRoute.post("/communities/tracked/:id/digests", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 400);
  const tracked = await getOwnedCommunity(c.env.DB, ownerId, c.req.param("id"));
  if (!tracked) return c.json({ error: "not_found" }, 404);

  const body = await safeJson<NewDigestBody>(c.req);
  const summaryText = body.summaryText?.trim();
  if (!summaryText) {
    const row = await generateCommunityDigest({
      database: db(c.env.DB),
      env: c.env,
      tracked,
    });
    return c.json({ digest: toCommunityDigestSnapshot(row) }, 201);
  }
  const promptUsed = body.promptUsed?.trim() || tracked.prompt || "";
  if (!promptUsed) return c.json({ error: "missing_prompt_used" }, 400);

  const [row] = await db(c.env.DB)
    .insert(schema.communityDigestSnapshots)
    .values({
      id: crypto.randomUUID(),
      trackedCommunityId: tracked.id,
      ownerId,
      subreddit: tracked.subreddit,
      period: tracked.period,
      snapshotDate: body.snapshotDate ? new Date(body.snapshotDate) : new Date(),
      summaryText,
      summary: body.summary ?? null,
      promptUsed,
      sourceCount: Math.max(0, Math.floor(body.sourceCount ?? 0)),
      createdAt: new Date(),
    })
    .returning();

  return c.json({ digest: toCommunityDigestSnapshot(row) }, 201);
});

productsRoute.get("/communities/:subreddit/:period/digests", async (c) => {
  const subreddit = c.req.param("subreddit");
  const period = c.req.param("period");
  if (!isRedditPeriod(period)) return c.json({ error: "invalid_period" }, 400);

  const rows = await db(c.env.DB)
    .select({ digest: schema.communityDigestSnapshots })
    .from(schema.communityDigestSnapshots)
    .innerJoin(
      schema.trackedCommunities,
      eq(schema.communityDigestSnapshots.trackedCommunityId, schema.trackedCommunities.id),
    )
    .where(
      and(
        eq(schema.trackedCommunities.isPublic, true),
        eq(schema.communityDigestSnapshots.subreddit, subreddit),
        eq(schema.communityDigestSnapshots.period, period),
      ),
    )
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(clampedLimit(c.req.query("limit"), 12, 50));

  return c.json({ digests: rows.map((row) => toCommunityDigestSnapshot(row.digest)) });
});

productsRoute.get("/communities/discover", async (c) => {
  const period = c.req.query("period") ?? "week";
  if (!isRedditPeriod(period)) return c.json({ error: "invalid_period" }, 400);

  const rows = await db(c.env.DB)
    .select({ digest: schema.communityDigestSnapshots })
    .from(schema.communityDigestSnapshots)
    .innerJoin(
      schema.trackedCommunities,
      eq(schema.communityDigestSnapshots.trackedCommunityId, schema.trackedCommunities.id),
    )
    .where(
      and(
        eq(schema.trackedCommunities.isPublic, true),
        eq(schema.communityDigestSnapshots.period, period),
      ),
    )
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(clampedLimit(c.req.query("limit"), 25, 100));

  return c.json({ items: rows.map((row) => toCommunityDigestSnapshot(row.digest)) });
});

export function productDashboardSnapshot(input: {
  ownerId: string;
  configs: Array<typeof schema.mentionBrandConfigs.$inferSelect>;
  prompts: Array<typeof schema.mentionPrompts.$inferSelect>;
  recentChecks: Array<typeof schema.mentionChecks.$inferSelect>;
  tracked: Array<typeof schema.trackedCommunities.$inferSelect>;
  latestDigests: Array<typeof schema.communityDigestSnapshots.$inferSelect>;
}): ProductDashboardSnapshot {
  return {
    ownerId: input.ownerId,
    mentions: {
      configs: input.configs.map(toMentionBrandConfig),
      prompts: input.prompts.map(toMentionPrompt),
      recentChecks: input.recentChecks.map(toMentionCheck),
    },
    communities: {
      tracked: input.tracked.map(toTrackedCommunity),
      latestDigests: input.latestDigests.map(toCommunityDigestSnapshot),
    },
  };
}

function toMentionBrandConfig(
  row: typeof schema.mentionBrandConfigs.$inferSelect,
): MentionBrandConfig {
  return {
    id: row.id,
    companyId: row.ownerId,
    brandName: row.brandName,
    brandAliases: stringArray(row.brandAliases),
    brandUrl: row.brandUrl,
    competitors: objectArray<{ name: string; url?: string }>(row.competitors).filter((item) =>
      Boolean(item.name),
    ),
    platforms: stringArray(row.platforms).filter(isAIPlatform),
    aiEndpointUrl: row.aiEndpointUrl,
    aiModel: row.aiModel,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMentionPrompt(row: typeof schema.mentionPrompts.$inferSelect): MentionPrompt {
  return {
    id: row.id,
    companyId: row.ownerId,
    promptText: row.promptText,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMentionCheck(row: typeof schema.mentionChecks.$inferSelect): MentionCheck {
  return {
    id: row.id,
    companyId: row.ownerId,
    configId: row.configId,
    status: row.status,
    totalQueries: row.totalQueries,
    completedQueries: row.completedQueries,
    brandMentionRate: row.brandMentionRate,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toTrackedCommunity(row: typeof schema.trackedCommunities.$inferSelect): TrackedCommunity {
  return {
    id: row.id,
    ownerId: row.ownerId,
    subreddit: row.subreddit,
    prompt: row.prompt,
    period: row.period,
    isPublic: row.isPublic,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCommunityDigestSnapshot(
  row: typeof schema.communityDigestSnapshots.$inferSelect,
): CommunityDigestSnapshot {
  return {
    id: row.id,
    subreddit: row.subreddit,
    period: row.period,
    snapshotDate: row.snapshotDate.toISOString(),
    summaryText: row.summaryText,
    summary: normalizeCommunitySummary(row.summary),
    promptUsed: row.promptUsed,
    sourceCount: row.sourceCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAgentEvaluationAudit(
  row: typeof schema.agentEvaluationAudits.$inferSelect,
): AgentEvaluationAudit {
  return {
    id: row.id,
    ownerId: row.ownerId,
    brandName: row.brandName,
    brandUrl: row.brandUrl,
    buyerMission: row.buyerMission,
    targetSegment: row.targetSegment,
    competitors: objectArray<AgentEvaluationCompetitor>(row.competitors).filter((item) =>
      Boolean(item.name),
    ),
    status: row.status as AgentAuditStatus,
    overallScore: row.overallScore,
    recommendationSummary: row.recommendationSummary,
    evidenceText: row.evidenceText,
    evidenceUrls: stringArray(row.evidenceUrls),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toAgentPromptResult(
  row: typeof schema.agentEvaluationResponses.$inferSelect,
): PersistedAgentPromptResult {
  return {
    id: row.id,
    auditId: row.auditId,
    promptKey: row.promptKey,
    promptText: row.promptText,
    surface: row.surface,
    responseText: row.responseText,
    brandMentioned: row.brandMentioned,
    brandRecommended: row.brandRecommended,
    competitorsMentioned: objectArray<AgentEvaluationCompetitor>(row.competitorsMentioned).filter(
      (item) => Boolean(item.name),
    ),
    citations: stringArray(row.citations),
    createdAt: row.createdAt.toISOString(),
  };
}

function toEvidenceLayerScore(
  row: typeof schema.agentEvidenceScores.$inferSelect,
): PersistedEvidenceLayerScore {
  return {
    id: row.id,
    auditId: row.auditId,
    area: row.area,
    status: row.status as EvidenceScoreStatus,
    score: row.score,
    evidenceUrls: stringArray(row.evidenceUrls),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMissingEvidenceTask(
  row: typeof schema.agentEvidenceTasks.$inferSelect,
): PersistedMissingEvidenceTask {
  return {
    id: row.id,
    auditId: row.auditId,
    area: row.area,
    title: row.title,
    priority: row.priority as AgentTaskPriority,
    status: row.status as AgentTaskStatus,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

function toReelBrief(row: typeof schema.reelBriefs.$inferSelect): PersistedReelBrief {
  return {
    id: row.id,
    auditId: row.auditId,
    title: row.title,
    hook: row.hook,
    buyerMission: row.buyerMission,
    proofPoints: stringArray(row.proofPoints),
    visualBeats: stringArray(row.visualBeats),
    caption: row.caption,
    cta: row.cta,
    claimBoundary: row.claimBoundary,
    evidenceUrls: stringArray(row.evidenceUrls),
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadAgentEvaluationAudit(
  d1: D1Database,
  ownerId: string,
  id: string,
): Promise<AgentEvaluationAuditDetail | null> {
  const database = db(d1);
  const [audit] = await database
    .select()
    .from(schema.agentEvaluationAudits)
    .where(and(eq(schema.agentEvaluationAudits.ownerId, ownerId), eq(schema.agentEvaluationAudits.id, id)))
    .limit(1);
  if (!audit) return null;

  const [prompts, scores, tasks, reelBriefs] = await Promise.all([
    database
      .select()
      .from(schema.agentEvaluationResponses)
      .where(eq(schema.agentEvaluationResponses.auditId, id)),
    database
      .select()
      .from(schema.agentEvidenceScores)
      .where(eq(schema.agentEvidenceScores.auditId, id)),
    database
      .select()
      .from(schema.agentEvidenceTasks)
      .where(eq(schema.agentEvidenceTasks.auditId, id)),
    database.select().from(schema.reelBriefs).where(eq(schema.reelBriefs.auditId, id)),
  ]);

  return {
    audit: toAgentEvaluationAudit(audit),
    prompts: prompts.map(toAgentPromptResult),
    scores: scores.map(toEvidenceLayerScore),
    tasks: tasks.map(toMissingEvidenceTask),
    reelBriefs: reelBriefs.map(toReelBrief),
  };
}

async function getConfig(d1: D1Database, id: string) {
  const [row] = await db(d1)
    .select()
    .from(schema.mentionBrandConfigs)
    .where(eq(schema.mentionBrandConfigs.id, id))
    .limit(1);
  return row ?? null;
}

async function getOwnedConfig(d1: D1Database, ownerId: string, id: string) {
  const [row] = await db(d1)
    .select()
    .from(schema.mentionBrandConfigs)
    .where(and(eq(schema.mentionBrandConfigs.ownerId, ownerId), eq(schema.mentionBrandConfigs.id, id)))
    .limit(1);
  return row ?? null;
}

async function getOwnedCommunity(d1: D1Database, ownerId: string, id: string) {
  const [row] = await db(d1)
    .select()
    .from(schema.trackedCommunities)
    .where(and(eq(schema.trackedCommunities.ownerId, ownerId), eq(schema.trackedCommunities.id, id)))
    .limit(1);
  return row ?? null;
}

function requireOwner(c: { req: { query(name: string): string | undefined; header(name: string): string | undefined } }) {
  return c.req.query("owner")?.trim() || c.req.header("x-high-signal-owner")?.trim() || "";
}

async function safeJson<T extends object>(request: { text(): Promise<string> }): Promise<T> {
  const raw = await request.text();
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function parseBrandConfigInput(
  ownerId: string,
  body: NewConfigBody,
  existing?: typeof schema.mentionBrandConfigs.$inferSelect,
):
  | { values: typeof schema.mentionBrandConfigs.$inferInsert }
  | { error: string } {
  const brandName = body.brandName?.trim() || existing?.brandName || "";
  if (!brandName) return { error: "missing_brand_name" };
  const competitors = body.competitors ?? objectArray<CompetitorProfile>(existing?.competitors);
  if (competitors.length > 8) return { error: "too_many_competitors" };
  const platforms = body.platforms ?? stringArray(existing?.platforms).filter(isAIPlatform);
  if (platforms.length === 0 || !platforms.every(isAIPlatform)) return { error: "invalid_platforms" };
  const schedule = body.checkSchedule === undefined ? existing?.checkSchedule : body.checkSchedule;
  if (schedule != null && !["daily", "weekly"].includes(schedule)) return { error: "invalid_schedule" };

  return {
    values: {
      id: existing?.id ?? crypto.randomUUID(),
      ownerId,
      brandName,
      brandAliases: body.brandAliases ?? stringArray(existing?.brandAliases),
      brandUrl: body.brandUrl === undefined ? (existing?.brandUrl ?? null) : body.brandUrl,
      competitors,
      platforms,
      aiEndpointUrl:
        body.aiEndpointUrl === undefined ? (existing?.aiEndpointUrl ?? null) : body.aiEndpointUrl,
      aiModel: body.aiModel === undefined ? (existing?.aiModel ?? null) : body.aiModel,
      checkSchedule: schedule ?? null,
      lastScheduledCheck: existing?.lastScheduledCheck ?? null,
      badgeEnabled: body.badgeEnabled ?? existing?.badgeEnabled ?? false,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    },
  };
}

function parseTrackedCommunityInput(
  ownerId: string,
  body: NewCommunityBody,
  existing?: typeof schema.trackedCommunities.$inferSelect,
):
  | { values: typeof schema.trackedCommunities.$inferInsert }
  | { error: string } {
  const subreddit = (body.subreddit ?? existing?.subreddit ?? "").replace(/^r\//i, "").trim();
  if (!subreddit) return { error: "missing_subreddit" };
  const period = body.period ?? existing?.period ?? "week";
  if (!isRedditPeriod(period)) return { error: "invalid_period" };
  return {
    values: {
      id: existing?.id ?? crypto.randomUUID(),
      ownerId,
      subreddit,
      prompt: body.prompt === undefined ? (existing?.prompt ?? null) : body.prompt,
      period,
      isPublic: body.isPublic ?? existing?.isPublic ?? false,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    },
  };
}

function parseAgentAuditInput(
  ownerId: string,
  body: NewAgentAuditBody,
):
  | {
      input: {
        ownerId: string;
        brandName: string;
        brandUrl: string;
        buyerMission: string;
        targetSegment: string | null;
        competitors: AgentEvaluationCompetitor[];
        evidenceText: string | null;
        evidenceUrls: string[];
      };
    }
  | { error: string } {
  const brandName = body.brandName?.trim() ?? "";
  const brandUrl = body.brandUrl?.trim() ?? "";
  const buyerMission = body.buyerMission?.trim() ?? "";
  if (!brandName) return { error: "missing_brand_name" };
  if (!/^https?:\/\//i.test(brandUrl)) return { error: "invalid_brand_url" };
  if (!buyerMission) return { error: "missing_buyer_mission" };
  const competitors = (body.competitors ?? [])
    .map((competitor) => ({
      name: competitor.name?.trim() ?? "",
      url: competitor.url?.trim() || undefined,
    }))
    .filter((competitor) => competitor.name);
  if (competitors.length > 8) return { error: "too_many_competitors" };
  const evidenceUrls = [
    brandUrl,
    ...(body.evidenceUrls ?? []).filter((url) => /^https?:\/\//i.test(url)),
  ];

  return {
    input: {
      ownerId,
      brandName,
      brandUrl,
      buyerMission,
      targetSegment: body.targetSegment?.trim() || null,
      competitors,
      evidenceText: body.evidenceText?.trim() || null,
      evidenceUrls: [...new Set(evidenceUrls)],
    },
  };
}

function visibilityBadge(
  config: MentionBrandConfig,
  check: MentionCheck,
  results: Array<typeof schema.mentionResults.$inferSelect>,
) {
  const total = Math.max(results.length, 1);
  const mentionedResults = results.filter((result) => result.brandMentioned);
  const mentionRate = check.brandMentionRate ?? mentionedResults.length / total;
  const mentionScore = Math.round(mentionRate * 30);
  const positiveCount = mentionedResults.filter((result) => result.brandSentiment === "positive").length;
  const sentimentScore = mentionedResults.length
    ? Math.round((positiveCount / mentionedResults.length) * 20)
    : 0;
  const positioned = mentionedResults.filter((result) => result.brandPosition && result.brandPosition > 0);
  const positionScore = positioned.length
    ? Math.round(Math.max(0, 20 - ((positioned.reduce((sum, result) => sum + (result.brandPosition ?? 0), 0) / positioned.length) - 1) * 4))
    : 0;
  const citationScore = Math.round((results.filter((result) => result.brandCited).length / total) * 15);
  const platforms = new Set(results.map((result) => result.platform));
  const mentionedPlatforms = new Set(mentionedResults.map((result) => result.platform));
  const reachScore = platforms.size ? Math.round((mentionedPlatforms.size / platforms.size) * 15) : 0;
  const score = mentionScore + sentimentScore + positionScore + citationScore + reachScore;

  return {
    configId: config.id,
    brandName: config.brandName,
    score,
    grade: score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F",
    platformsChecked: platforms.size,
    platformsMentioned: mentionedPlatforms.size,
    mentionRate: Math.round(mentionRate * 100) / 100,
    platformDetails: Array.from(platforms).map((platform) => ({
      platform,
      mentioned: mentionedPlatforms.has(platform),
    })),
    lastChecked: check.completedAt ?? check.createdAt,
    cachedAt: new Date().toISOString(),
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function objectArray<T extends object>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => Boolean(item) && typeof item === "object");
}

function isAIPlatform(value: string): value is AIPlatform {
  return ["openai", "anthropic", "google", "perplexity", "custom"].includes(value);
}

function isRedditPeriod(value: string): value is "day" | "week" | "month" {
  return ["day", "week", "month"].includes(value);
}

// ─── Plan 0011 — OpenLens visibility surface ──────────────────────────────
// All routes are read-only (they project from mention_results /
// agent_evidence_scores / agent_evidence_tasks) except cited-sources/refresh
// which rebuilds the cited_url_index for a brand from the latest run window.

async function loadOwnedBrand(d1: D1Database, ownerId: string, brandId: string) {
  if (!ownerId) return null;
  const [brand] = await db(d1)
    .select()
    .from(schema.mentionBrandConfigs)
    .where(
      and(
        eq(schema.mentionBrandConfigs.id, brandId),
        eq(schema.mentionBrandConfigs.ownerId, ownerId),
      ),
    )
    .limit(1);
  return brand ?? null;
}

async function loadMentionRowsForBrand(d1: D1Database, brandId: string, windowDays: number) {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
  return db(d1)
    .select()
    .from(schema.mentionResults)
    .where(
      and(
        eq(schema.mentionResults.configId, brandId),
        gte(schema.mentionResults.createdAt, since),
      ),
    )
    .orderBy(desc(schema.mentionResults.createdAt))
    .limit(5000);
}

productsRoute.get("/mentions/:brandId/visibility-matrix", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }
  const windowDays = clampedLimit(c.req.query("window") ?? "30", 30, 365);
  const rows = await loadMentionRowsForBrand(c.env.DB, brandId, windowDays);

  // Map mention_results rows to MatrixRow. prompt_text is needed to render the
  // human label; fetch prompts in one query.
  const promptIds = Array.from(new Set(rows.map((r) => r.promptId)));
  const prompts =
    promptIds.length > 0
      ? await c.env.DB.prepare(
          `SELECT id, prompt_text FROM mention_prompts WHERE id IN (${promptIds
            .map(() => "?")
            .join(",")})`,
        )
          .bind(...promptIds)
          .all<{ id: string; prompt_text: string }>()
      : { results: [] };
  const promptMap = new Map((prompts.results ?? []).map((p) => [p.id, p.prompt_text]));

  const matrix: MatrixRow[] = rows.map((r) => ({
    prompt: promptMap.get(r.promptId) ?? r.promptId,
    promptKey: r.promptId,
    platform: r.platform,
    brandMentioned: r.brandMentioned,
    brandRecommended: false, // mention_results carries brandCited; recommended lives in agent-eval responses
    competitorsMentioned: ((r.competitorsMentioned as unknown) as string[]) ?? [],
    citations: ((r.citations as unknown) as string[]) ?? [],
    runAt: r.createdAt.toISOString(),
  }));
  return c.json({ cells: buildVisibilityMatrix(matrix), windowDays, runs: rows.length });
});

function toMentionRows(rows: Array<typeof schema.mentionResults.$inferSelect>): MentionRow[] {
  return rows.map((r) => ({
    brandMentioned: r.brandMentioned,
    brandRecommended: false,
    competitorsMentioned: ((r.competitorsMentioned as unknown) as string[]) ?? [],
    citations: ((r.citations as unknown) as string[]) ?? [],
    brandCited: r.brandCited,
    platform: r.platform,
    createdAt: r.createdAt.toISOString(),
  }));
}

productsRoute.get("/mentions/:brandId/share-of-voice", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }
  const windowDays = clampedLimit(c.req.query("window") ?? "30", 30, 365);
  const rows = await loadMentionRowsForBrand(c.env.DB, brandId, windowDays);
  return c.json(computeShareOfVoice(toMentionRows(rows), windowDays));
});

productsRoute.get("/mentions/:brandId/cited-sources", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }
  const ownership = c.req.query("ownership");
  const topic = c.req.query("topic");
  const rows = await db(c.env.DB)
    .select()
    .from(schema.citedUrlIndex)
    .where(eq(schema.citedUrlIndex.brandId, brandId))
    .orderBy(desc(schema.citedUrlIndex.mentionRunCount))
    .limit(200);
  const filtered = rows.filter((r) => {
    if (ownership && r.ownership !== ownership) return false;
    if (topic && r.topic !== topic) return false;
    return true;
  });
  return c.json({ sources: filtered });
});

productsRoute.post("/mentions/:brandId/cited-sources/refresh", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  const brand = await loadOwnedBrand(c.env.DB, ownerId, brandId);
  if (!brand) return c.json({ error: "brand_not_found" }, 404);

  const windowDays = clampedLimit(c.req.query("window") ?? "30", 30, 365);
  const rows = await loadMentionRowsForBrand(c.env.DB, brandId, windowDays);
  const competitors = ((brand.competitors as unknown) as Array<{ id?: string; name?: string; url?: string }>) ?? [];
  const competitorUrls = competitors
    .filter((c) => c.url)
    .map((c) => ({ id: c.id ?? c.name ?? c.url!, url: c.url! }));
  const brandIdentity = {
    brandUrl: brand.brandUrl ?? null,
    competitorUrls,
  };

  const agg = new Map<
    string,
    {
      url: string;
      host: string;
      ownership: ReturnType<typeof classifyOwnership>["ownership"];
      competitorId?: string;
      platforms: Set<string>;
      first: Date;
      last: Date;
      count: number;
    }
  >();

  for (const r of rows) {
    const citations = ((r.citations as unknown) as string[]) ?? [];
    for (const url of citations) {
      const h = hostOf(url);
      if (!h) continue;
      const existing = agg.get(url);
      const { ownership, competitorId } = classifyOwnership(url, brandIdentity);
      const platforms = existing?.platforms ?? new Set<string>();
      platforms.add(r.platform);
      const first = existing ? (r.createdAt < existing.first ? r.createdAt : existing.first) : r.createdAt;
      const last = existing ? (r.createdAt > existing.last ? r.createdAt : existing.last) : r.createdAt;
      agg.set(url, {
        url,
        host: h,
        ownership,
        competitorId,
        platforms,
        first,
        last,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  let upserts = 0;
  for (const entry of agg.values()) {
    const id = await sha16(`cited:${brandId}:${entry.url}`);
    await db(c.env.DB)
      .insert(schema.citedUrlIndex)
      .values({
        id,
        brandId,
        topic: "",
        url: entry.url,
        host: entry.host,
        ownership: entry.ownership,
        competitorId: entry.competitorId ?? null,
        firstSeenAt: entry.first,
        lastSeenAt: entry.last,
        platforms: Array.from(entry.platforms),
        mentionRunCount: entry.count,
      })
      .onConflictDoUpdate({
        target: [schema.citedUrlIndex.brandId, schema.citedUrlIndex.url],
        set: {
          ownership: entry.ownership,
          competitorId: entry.competitorId ?? null,
          lastSeenAt: entry.last,
          platforms: Array.from(entry.platforms),
          mentionRunCount: entry.count,
        },
      });
    upserts++;
  }

  return c.json({ upserts, windowDays });
});

productsRoute.get("/mentions/:brandId/intent-opportunities", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }

  const status = parseIntentStatus(c.req.query("status")) ?? "open";
  const source = c.req.query("source")?.trim();
  const limit = clampedLimit(c.req.query("limit") ?? "25", 25, 100);
  const rows = await db(c.env.DB)
    .select()
    .from(schema.intentOpportunities)
    .where(
      and(
        eq(schema.intentOpportunities.brandId, brandId),
        eq(schema.intentOpportunities.ownerId, ownerId),
        eq(schema.intentOpportunities.status, status),
      ),
    )
    .orderBy(desc(schema.intentOpportunities.score), desc(schema.intentOpportunities.updatedAt))
    .limit(200);

  const filtered = source ? rows.filter((r) => r.source === source) : rows;
  return c.json({ opportunities: filtered.slice(0, limit), status });
});

productsRoute.post("/mentions/:brandId/intent-opportunities/refresh", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  const brand = await loadOwnedBrand(c.env.DB, ownerId, brandId);
  if (!brand) return c.json({ error: "brand_not_found" }, 404);

  const windowDays = clampedLimit(c.req.query("window") ?? "14", 14, 90);
  const limit = clampedLimit(c.req.query("limit") ?? "50", 50, 200);
  return c.json(await refreshIntentOpportunitiesForBrand(db(c.env.DB), ownerId, brand, { windowDays, limit }));
});

productsRoute.patch("/mentions/:brandId/intent-opportunities/:id", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }
  const body = await safeJson<PatchIntentOpportunityBody>(c.req);
  const status = parseIntentStatus(body.status);
  if (!status) return c.json({ error: "invalid_status" }, 400);

  const [row] = await db(c.env.DB)
    .update(schema.intentOpportunities)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.intentOpportunities.id, c.req.param("id")),
        eq(schema.intentOpportunities.brandId, brandId),
        eq(schema.intentOpportunities.ownerId, ownerId),
      ),
    )
    .returning();

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ opportunity: row });
});

productsRoute.post("/mentions/:brandId/intent-opportunities/:id/reply-draft", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  const brand = await loadOwnedBrand(c.env.DB, ownerId, brandId);
  if (!brand) return c.json({ error: "brand_not_found" }, 404);

  const [opportunity] = await db(c.env.DB)
    .select()
    .from(schema.intentOpportunities)
    .where(
      and(
        eq(schema.intentOpportunities.id, c.req.param("id")),
        eq(schema.intentOpportunities.brandId, brandId),
        eq(schema.intentOpportunities.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!opportunity) return c.json({ error: "not_found" }, 404);

  const config = resolveBrandAIConfig(brand, c.env);
  if (!config) return c.json({ error: "ai_not_configured" }, 409);

  const response = await fetchChatCompletion({
    config,
    stream: false,
    maxTokens: 420,
    systemPrompt:
      "You draft short, operator-reviewed community replies for a brand. Never auto-post, never fabricate facts, and include a clear affiliation disclosure when the author would be speaking for the brand.",
    messages: [
      {
        role: "user",
        content: buildIntentReplyPrompt(brand, opportunity),
      },
    ],
  });
  if (!response.ok) {
    const text = await response.text();
    return c.json({ error: "ai_request_failed", detail: text.slice(0, 200) }, 502);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const replyDraft = cleanReplyDraft(json.choices?.[0]?.message?.content ?? "");
  if (!replyDraft) return c.json({ error: "empty_reply_draft" }, 502);

  const [row] = await db(c.env.DB)
    .update(schema.intentOpportunities)
    .set({ replyDraft, updatedAt: new Date() })
    .where(eq(schema.intentOpportunities.id, opportunity.id))
    .returning();

  return c.json({ opportunity: row });
});

productsRoute.get("/mentions/:brandId/trends", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }
  const windowDays = clampedLimit(c.req.query("window") ?? "30", 30, 365);
  const rows = await loadMentionRowsForBrand(c.env.DB, brandId, windowDays);
  return c.json({ points: computeTrends(toMentionRows(rows), windowDays, Date.now()) });
});

productsRoute.get("/mentions/:brandId/report", async (c) => {
  const ownerId = requireOwner(c);
  const brandId = c.req.param("brandId");
  if (!(await loadOwnedBrand(c.env.DB, ownerId, brandId))) {
    return c.json({ error: "brand_not_found" }, 404);
  }
  const windowDays = clampedLimit(c.req.query("window") ?? "30", 30, 365);
  const rows = await loadMentionRowsForBrand(c.env.DB, brandId, windowDays);
  const mentionRows = toMentionRows(rows);
  const sov = computeShareOfVoice(mentionRows, windowDays);
  const points = computeTrends(mentionRows, windowDays, Date.now());

  const matrixRows: MatrixRow[] = rows.map((r) => ({
    prompt: r.promptId,
    promptKey: r.promptId,
    platform: r.platform,
    brandMentioned: r.brandMentioned,
    brandRecommended: false,
    competitorsMentioned: ((r.competitorsMentioned as unknown) as string[]) ?? [],
    citations: ((r.citations as unknown) as string[]) ?? [],
    runAt: r.createdAt.toISOString(),
  }));
  const matrix = buildVisibilityMatrix(matrixRows);

  const cited = await db(c.env.DB)
    .select()
    .from(schema.citedUrlIndex)
    .where(eq(schema.citedUrlIndex.brandId, brandId))
    .orderBy(desc(schema.citedUrlIndex.mentionRunCount))
    .limit(20);
  let intentOpportunities: Array<typeof schema.intentOpportunities.$inferSelect> = [];
  try {
    intentOpportunities = await db(c.env.DB)
      .select()
      .from(schema.intentOpportunities)
      .where(
        and(
          eq(schema.intentOpportunities.brandId, brandId),
          eq(schema.intentOpportunities.ownerId, ownerId),
          eq(schema.intentOpportunities.status, "open"),
        ),
      )
      .orderBy(desc(schema.intentOpportunities.score), desc(schema.intentOpportunities.updatedAt))
      .limit(10);
  } catch (error) {
    console.error("High Signal intent opportunities unavailable for report:", error);
  }

  return c.json({
    windowDays,
    summary: {
      runs: sov.runs,
      brandMentionRate: sov.brandMentionRate,
      brandCitationRate: sov.brandCitationRate,
      trendPoints: points.length,
    },
    matrix,
    shareOfVoice: sov,
    citedSources: cited,
    intentOpportunities,
  });
});

// Agent-eval attribute grid. Reads agent_evidence_scores + open tasks.
productsRoute.get("/agent-eval/:auditId/attributes", async (c) => {
  const ownerId = requireOwner(c);
  if (!ownerId) return c.json({ error: "missing_owner" }, 401);
  const auditId = c.req.param("auditId");
  const [audit] = await db(c.env.DB)
    .select({ id: schema.agentEvaluationAudits.id })
    .from(schema.agentEvaluationAudits)
    .where(
      and(
        eq(schema.agentEvaluationAudits.id, auditId),
        eq(schema.agentEvaluationAudits.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!audit) return c.json({ error: "audit_not_found" }, 404);
  const scores = await db(c.env.DB)
    .select()
    .from(schema.agentEvidenceScores)
    .where(eq(schema.agentEvidenceScores.auditId, auditId));
  const tasks = await db(c.env.DB)
    .select()
    .from(schema.agentEvidenceTasks)
    .where(eq(schema.agentEvidenceTasks.auditId, auditId));
  const taskCountByArea = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === "open") taskCountByArea.set(t.area, (taskCountByArea.get(t.area) ?? 0) + 1);
  }
  const rows: AttributeRow[] = scores.map((s) => ({
    area: s.area,
    status: s.status,
    evidenceUrls: ((s.evidenceUrls as unknown) as string[]) ?? [],
    notes: s.notes,
    taskCount: taskCountByArea.get(s.area) ?? 0,
  }));
  return c.json({ attributes: sortAttributes(rows) });
});

function parseIntentStatus(value: unknown): IntentStatus | null {
  return value === "open" || value === "dismissed" || value === "done" ? value : null;
}

async function refreshIntentOpportunitiesForBrand(
  database: ReturnType<typeof db>,
  ownerId: string,
  brand: typeof schema.mentionBrandConfigs.$inferSelect,
  options: { windowDays: number; limit: number },
) {
  const { windowDays, limit } = options;
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
  const competitors = objectArray<{ name?: string; url?: string }>(brand.competitors || []);
  const brandAliases = stringArray(brand.brandAliases);
  const hasSearchTerms = [brand.brandName, ...brandAliases, ...competitors.map((item) => item.name ?? "")]
    .some((keyword) => keyword.trim().length >= 2);
  if (!hasSearchTerms) return { upserts: 0, scanned: 0, windowDays };

  const events = await database
    .select()
    .from(schema.events)
    .where(and(gte(schema.events.publishedAt, since), inArray(schema.events.source, [...COMMUNITY_INTENT_SOURCES])))
    .orderBy(desc(schema.events.publishedAt))
    .limit(1000);

  const candidates = events
    .map((event) =>
      scoreIntentOpportunity(
        {
          source: event.source,
          sourceUrl: event.sourceUrl,
          title: event.title,
          content: event.content,
          publishedAt: event.publishedAt,
        },
        {
          brandName: brand.brandName,
          brandAliases,
          competitors,
        },
      ),
    )
    .filter((item): item is IntentOpportunityCandidate => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  let upserts = 0;
  for (const item of candidates) {
    const id = await sha16(`intent:${brand.id}:${item.sourceUrl}`);
    const evidenceTaskId = await ensureIntentEvidenceTask(database, ownerId, brand, item);
    await database
      .insert(schema.intentOpportunities)
      .values({
        id,
        brandId: brand.id,
        ownerId,
        source: item.source,
        sourceUrl: item.sourceUrl,
        sourceTitle: item.sourceTitle,
        sourceExcerpt: item.sourceExcerpt,
        platform: item.platform,
        intentStage: item.intentStage,
        actionType: item.actionType,
        score: item.score,
        competitors: item.competitors,
        matchedKeywords: item.matchedKeywords,
        evidenceTaskId,
        replyDraft: null,
        status: "open",
        foundAt: item.foundAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.intentOpportunities.brandId, schema.intentOpportunities.sourceUrl],
        set: {
          sourceTitle: item.sourceTitle,
          sourceExcerpt: item.sourceExcerpt,
          platform: item.platform,
          intentStage: item.intentStage,
          actionType: item.actionType,
          score: item.score,
          competitors: item.competitors,
          matchedKeywords: item.matchedKeywords,
          updatedAt: new Date(),
        },
      });
    if (evidenceTaskId) {
      await database
        .update(schema.intentOpportunities)
        .set({ evidenceTaskId })
        .where(
          and(
            eq(schema.intentOpportunities.brandId, brand.id),
            eq(schema.intentOpportunities.sourceUrl, item.sourceUrl),
          ),
        );
    }
    upserts++;
  }

  return { upserts, scanned: events.length, windowDays };
}

async function ensureIntentEvidenceTask(
  database: ReturnType<typeof db>,
  ownerId: string,
  brand: typeof schema.mentionBrandConfigs.$inferSelect,
  item: IntentOpportunityCandidate,
): Promise<string | null> {
  const task = intentEvidenceTaskFor(item);
  if (!task) return null;

  const [audit] = await database
    .select()
    .from(schema.agentEvaluationAudits)
    .where(
      and(
        eq(schema.agentEvaluationAudits.ownerId, ownerId),
        eq(schema.agentEvaluationAudits.brandName, brand.brandName),
      ),
    )
    .orderBy(desc(schema.agentEvaluationAudits.createdAt))
    .limit(1);
  if (!audit) return null;

  const [existing] = await database
    .select()
    .from(schema.agentEvidenceTasks)
    .where(
      and(
        eq(schema.agentEvidenceTasks.auditId, audit.id),
        eq(schema.agentEvidenceTasks.sourceUrl, item.sourceUrl),
        eq(schema.agentEvidenceTasks.status, "open"),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await database
    .insert(schema.agentEvidenceTasks)
    .values({
      id: crypto.randomUUID(),
      auditId: audit.id,
      ownerId,
      area: task.area,
      title: task.title,
      priority: task.priority,
      status: "open",
      sourceUrl: item.sourceUrl,
      createdAt: new Date(),
    })
    .returning();
  return created?.id ?? null;
}

function intentEvidenceTaskFor(item: IntentOpportunityCandidate): {
  area: string;
  title: string;
  priority: "high" | "medium" | "low";
} | null {
  const title = item.sourceTitle.length > 90 ? `${item.sourceTitle.slice(0, 89).trim()}...` : item.sourceTitle;
  if (item.actionType === "create_proof") {
    return { area: "proof", title: `Add proof for buyer question: ${title}`, priority: "high" };
  }
  if (item.actionType === "write_comparison") {
    return { area: "comparisons", title: `Publish comparison response for: ${title}`, priority: "high" };
  }
  if (item.actionType === "add_integration") {
    return { area: "docs", title: `Document integration need from: ${title}`, priority: "medium" };
  }
  if (item.actionType === "improve_docs") {
    return { area: "docs", title: `Clarify docs/support gap from: ${title}`, priority: "medium" };
  }
  if (item.actionType === "content_opportunity") {
    return { area: "positioning", title: `Create content answer for: ${title}`, priority: "medium" };
  }
  return null;
}

function resolveBrandAIConfig(
  brand: typeof schema.mentionBrandConfigs.$inferSelect,
  env: Env,
): AIConfig | null {
  const apiKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  const model = brand.aiModel || env.HIGH_SIGNAL_AI_MODEL || "auto";
  if (!apiKey || !model) return null;
  return {
    endpointUrl: brand.aiEndpointUrl || env.HIGH_SIGNAL_AI_ENDPOINT_URL || FREE_AI_DEFAULT_ENDPOINT,
    apiKey,
    model,
  };
}

function buildIntentReplyPrompt(
  brand: typeof schema.mentionBrandConfigs.$inferSelect,
  opportunity: typeof schema.intentOpportunities.$inferSelect,
) {
  const competitors = stringArray(opportunity.competitors).join(", ") || "none detected";
  const matchedKeywords = stringArray(opportunity.matchedKeywords).join(", ") || "none";
  return [
    `Brand: ${brand.brandName}`,
    `Brand URL: ${brand.brandUrl || "not provided"}`,
    `Intent stage: ${opportunity.intentStage}`,
    `Suggested action: ${opportunity.actionType}`,
    `Source: ${opportunity.source}`,
    `Source title: ${opportunity.sourceTitle}`,
    `Source excerpt: ${opportunity.sourceExcerpt}`,
    `Competitors detected: ${competitors}`,
    `Matched terms: ${matchedKeywords}`,
    "",
    "Draft one reply the operator could review before posting.",
    "Requirements:",
    "- 90 to 150 words.",
    "- Sound useful and specific, not salesy.",
    "- If speaking as the brand, disclose affiliation in the first sentence.",
    "- Do not claim features, pricing, customers, benchmarks, or integrations not present in the source excerpt.",
    "- If the best response is not to reply publicly, say so and suggest the private/content follow-up instead.",
  ].join("\n");
}

function cleanReplyDraft(value: string) {
  return value
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
    .slice(0, 1800);
}

function clampedLimit(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}
