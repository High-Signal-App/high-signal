import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { BADGE_WIDGET_JS } from "../lib/badge-widget";
import { generateCommunityDigest } from "../lib/community-research";
import { searchExternalMentions } from "../lib/external-monitors";
import { runMentionCheck } from "../lib/mention-execution";
import { buildAgentEvaluationAudit, normalizeCommunitySummary } from "@high-signal/shared";
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

  const result = buildAgentEvaluationAudit(parsed.input);
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
    }).catch((error) => console.error("High Signal mention check failed:", error)),
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
    },
  });
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

function clampedLimit(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}
