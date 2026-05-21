import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker"),
    name: text("name").notNull(),
    type: text("type", { enum: ["public", "private", "sector", "product"] }).notNull(),
    country: text("country"),
    sector: text("sector"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("entities_ticker_idx").on(t.ticker), index("entities_sector_idx").on(t.sector)],
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: text("id").primaryKey(),
    fromEntityId: text("from_entity_id")
      .notNull()
      .references(() => entities.id),
    toEntityId: text("to_entity_id")
      .notNull()
      .references(() => entities.id),
    type: text("type", {
      enum: ["supplier", "customer", "peer", "subsidiary", "partner", "competitor"],
    }).notNull(),
    weight: real("weight").default(1.0),
    verified: integer("verified", { mode: "boolean" }).default(false),
    evidenceUrl: text("evidence_url"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("relationships_from_idx").on(t.fromEntityId),
    index("relationships_to_idx").on(t.toEntityId),
    uniqueIndex("relationships_unique").on(t.fromEntityId, t.toEntityId, t.type),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
    title: text("title"),
    content: text("content"),
    primaryEntityId: text("primary_entity_id").references(() => entities.id),
    rawHash: text("raw_hash").notNull(),
    fetchRunId: text("fetch_run_id"),
    ingestedAt: integer("ingested_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("events_raw_hash_idx").on(t.rawHash),
    index("events_published_idx").on(t.publishedAt),
    index("events_primary_entity_idx").on(t.primaryEntityId),
    index("events_fetch_run_idx").on(t.fetchRunId),
  ],
);

export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    signalType: text("signal_type").notNull(),
    primaryEntityId: text("primary_entity_id")
      .notNull()
      .references(() => entities.id),
    direction: text("direction", { enum: ["up", "down", "neutral"] }).notNull(),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }).notNull(),
    predictedWindowDays: integer("predicted_window_days").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
    evidenceUrls: text("evidence_urls", { mode: "json" }).notNull(),
    spilloverEntityIds: text("spillover_entity_ids", { mode: "json" }),
    reviewStatus: text("review_status", {
      enum: ["draft", "published", "corrected"],
    })
      .notNull()
      .default("draft"),
    supersedesSignalId: text("supersedes_signal_id"),
    bodyMd: text("body_md").notNull(),
  },
  (t) => [
    uniqueIndex("signals_slug_idx").on(t.slug),
    index("signals_published_idx").on(t.publishedAt),
    index("signals_primary_entity_idx").on(t.primaryEntityId),
    index("signals_type_idx").on(t.signalType),
  ],
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id),
    url: text("url").notNull(),
    sourceType: text("source_type").notNull(),
    excerpt: text("excerpt"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
  },
  (t) => [index("evidence_signal_idx").on(t.signalId)],
);

export const scoreRuns = sqliteTable(
  "score_runs",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id),
    runAt: integer("run_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    windowDays: integer("window_days").notNull(),
    forwardReturn: real("forward_return"),
    outcome: text("outcome", {
      enum: ["hit", "miss", "push", "pending"],
    }).notNull(),
    notes: text("notes"),
  },
  (t) => [
    index("score_runs_signal_idx").on(t.signalId),
    index("score_runs_run_at_idx").on(t.runAt),
  ],
);

// Audit / replay storage — everything we'd want to debug 30d from now without
// access to memory. Append-only, never updated.

export const llmRuns = sqliteTable(
  "llm_runs",
  {
    id: text("id").primaryKey(),
    signalSlug: text("signal_slug"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version"),
    accepted: integer("accepted", { mode: "boolean" }).notNull(),
    reason: text("reason"),
    requestJson: text("request_json", { mode: "json" }).notNull(),
    responseJson: text("response_json", { mode: "json" }),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("llm_runs_created_idx").on(t.createdAt),
    index("llm_runs_signal_idx").on(t.signalSlug),
    index("llm_runs_accepted_idx").on(t.accepted),
  ],
);

export const marketQuotes = sqliteTable(
  "market_quotes",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["polymarket", "manifold", "kalshi"] }).notNull(),
    marketId: text("market_id").notNull(),
    entityId: text("entity_id").references(() => entities.id),
    question: text("question").notNull(),
    outcome: text("outcome", { enum: ["yes", "no", "binary"] }).notNull(),
    prob: real("prob").notNull(),
    volume: real("volume"),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    resolvedOutcome: text("resolved_outcome"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    marketUrl: text("market_url").notNull(),
  },
  (t) => [
    index("market_quotes_entity_idx").on(t.entityId),
    index("market_quotes_source_market_idx").on(t.source, t.marketId),
    index("market_quotes_fetched_idx").on(t.fetchedAt),
  ],
);

export const ingestRuns = sqliteTable(
  "ingest_runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    days: integer("days"),
    eventsFetched: integer("events_fetched").default(0),
    eventsDroppedNoEntity: integer("events_dropped_no_entity").default(0),
    eventsDroppedLowCluster: integer("events_dropped_low_cluster").default(0),
    signalsDrafted: integer("signals_drafted").default(0),
    errors: integer("errors").default(0),
    errorSample: text("error_sample"),
    notes: text("notes"),
  },
  (t) => [
    index("ingest_runs_source_idx").on(t.source),
    index("ingest_runs_started_idx").on(t.startedAt),
  ],
);

export const mentionBrandConfigs = sqliteTable(
  "mention_brand_configs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    brandName: text("brand_name").notNull(),
    brandAliases: text("brand_aliases", { mode: "json" }).notNull().default("[]"),
    brandUrl: text("brand_url"),
    competitors: text("competitors", { mode: "json" }).notNull().default("[]"),
    platforms: text("platforms", { mode: "json" }).notNull().default("[]"),
    aiEndpointUrl: text("ai_endpoint_url"),
    aiModel: text("ai_model"),
    checkSchedule: text("check_schedule", { enum: ["daily", "weekly"] }),
    lastScheduledCheck: integer("last_scheduled_check", { mode: "timestamp" }),
    badgeEnabled: integer("badge_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("mention_brand_configs_owner_idx").on(t.ownerId),
    uniqueIndex("mention_brand_configs_owner_brand_idx").on(t.ownerId, t.brandName),
  ],
);

export const mentionPrompts = sqliteTable(
  "mention_prompts",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => mentionBrandConfigs.id),
    ownerId: text("owner_id").notNull(),
    promptText: text("prompt_text").notNull(),
    category: text("category"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("mention_prompts_config_idx").on(t.configId),
    index("mention_prompts_owner_idx").on(t.ownerId),
  ],
);

export const mentionChecks = sqliteTable(
  "mention_checks",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => mentionBrandConfigs.id),
    ownerId: text("owner_id").notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    totalQueries: integer("total_queries").notNull().default(0),
    completedQueries: integer("completed_queries").notNull().default(0),
    brandMentionRate: real("brand_mention_rate"),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (t) => [
    index("mention_checks_config_idx").on(t.configId),
    index("mention_checks_owner_created_idx").on(t.ownerId, t.createdAt),
  ],
);

export const mentionResults = sqliteTable(
  "mention_results",
  {
    id: text("id").primaryKey(),
    checkId: text("check_id")
      .notNull()
      .references(() => mentionChecks.id),
    configId: text("config_id")
      .notNull()
      .references(() => mentionBrandConfigs.id),
    ownerId: text("owner_id").notNull(),
    promptId: text("prompt_id").notNull(),
    platform: text("platform").notNull(),
    model: text("model").notNull(),
    responseText: text("response_text").notNull(),
    brandMentioned: integer("brand_mentioned", { mode: "boolean" }).notNull().default(false),
    brandSentiment: text("brand_sentiment"),
    brandPosition: integer("brand_position"),
    competitorsMentioned: text("competitors_mentioned", { mode: "json" }).notNull().default("[]"),
    citations: text("citations", { mode: "json" }).notNull().default("[]"),
    brandCited: integer("brand_cited", { mode: "boolean" }).notNull().default(false),
    latencyMs: integer("latency_ms"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("mention_results_check_idx").on(t.checkId),
    index("mention_results_config_idx").on(t.configId),
  ],
);

export const trackedCommunities = sqliteTable(
  "tracked_communities",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    subreddit: text("subreddit").notNull(),
    prompt: text("prompt"),
    period: text("period", { enum: ["day", "week", "month"] }).notNull().default("week"),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("tracked_communities_owner_idx").on(t.ownerId),
    uniqueIndex("tracked_communities_owner_subreddit_period_idx").on(
      t.ownerId,
      t.subreddit,
      t.period,
    ),
  ],
);

export const communityDigestSnapshots = sqliteTable(
  "community_digest_snapshots",
  {
    id: text("id").primaryKey(),
    trackedCommunityId: text("tracked_community_id").references(() => trackedCommunities.id),
    ownerId: text("owner_id").notNull(),
    subreddit: text("subreddit").notNull(),
    period: text("period", { enum: ["day", "week", "month"] }).notNull(),
    snapshotDate: integer("snapshot_date", { mode: "timestamp" }).notNull(),
    summaryText: text("summary_text").notNull(),
    summary: text("summary", { mode: "json" }),
    promptUsed: text("prompt_used").notNull(),
    sourceCount: integer("source_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("community_digest_snapshots_track_idx").on(t.trackedCommunityId),
    index("community_digest_snapshots_owner_idx").on(t.ownerId),
    index("community_digest_snapshots_subreddit_period_idx").on(t.subreddit, t.period),
  ],
);

export const agentEvaluationAudits = sqliteTable(
  "agent_evaluation_audits",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    brandName: text("brand_name").notNull(),
    brandUrl: text("brand_url").notNull(),
    buyerMission: text("buyer_mission").notNull(),
    targetSegment: text("target_segment"),
    competitors: text("competitors", { mode: "json" }).notNull().default("[]"),
    status: text("status", { enum: ["completed", "failed"] }).notNull().default("completed"),
    overallScore: integer("overall_score").notNull().default(0),
    recommendationSummary: text("recommendation_summary").notNull(),
    evidenceText: text("evidence_text"),
    evidenceUrls: text("evidence_urls", { mode: "json" }).notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (t) => [
    index("agent_evaluation_audits_owner_created_idx").on(t.ownerId, t.createdAt),
    index("agent_evaluation_audits_brand_idx").on(t.brandName),
  ],
);

export const agentEvaluationResponses = sqliteTable(
  "agent_evaluation_responses",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => agentEvaluationAudits.id),
    ownerId: text("owner_id").notNull(),
    promptKey: text("prompt_key").notNull(),
    promptText: text("prompt_text").notNull(),
    surface: text("surface").notNull(),
    responseText: text("response_text").notNull(),
    brandMentioned: integer("brand_mentioned", { mode: "boolean" }).notNull().default(false),
    brandRecommended: integer("brand_recommended", { mode: "boolean" }).notNull().default(false),
    competitorsMentioned: text("competitors_mentioned", { mode: "json" }).notNull().default("[]"),
    citations: text("citations", { mode: "json" }).notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("agent_evaluation_responses_audit_idx").on(t.auditId),
    index("agent_evaluation_responses_owner_idx").on(t.ownerId),
  ],
);

export const agentEvidenceScores = sqliteTable(
  "agent_evidence_scores",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => agentEvaluationAudits.id),
    ownerId: text("owner_id").notNull(),
    area: text("area").notNull(),
    status: text("status", { enum: ["missing", "weak", "clear", "strong"] }).notNull(),
    score: integer("score").notNull(),
    evidenceUrls: text("evidence_urls", { mode: "json" }).notNull().default("[]"),
    notes: text("notes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("agent_evidence_scores_audit_idx").on(t.auditId),
    index("agent_evidence_scores_owner_idx").on(t.ownerId),
  ],
);

export const agentEvidenceTasks = sqliteTable(
  "agent_evidence_tasks",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => agentEvaluationAudits.id),
    ownerId: text("owner_id").notNull(),
    area: text("area").notNull(),
    title: text("title").notNull(),
    priority: text("priority", { enum: ["high", "medium", "low"] }).notNull(),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    sourceUrl: text("source_url"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("agent_evidence_tasks_audit_idx").on(t.auditId),
    index("agent_evidence_tasks_owner_status_idx").on(t.ownerId, t.status),
  ],
);

export const reelBriefs = sqliteTable(
  "reel_briefs",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => agentEvaluationAudits.id),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    hook: text("hook").notNull(),
    buyerMission: text("buyer_mission").notNull(),
    proofPoints: text("proof_points", { mode: "json" }).notNull().default("[]"),
    visualBeats: text("visual_beats", { mode: "json" }).notNull().default("[]"),
    caption: text("caption").notNull(),
    cta: text("cta").notNull(),
    claimBoundary: text("claim_boundary").notNull(),
    evidenceUrls: text("evidence_urls", { mode: "json" }).notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("reel_briefs_audit_idx").on(t.auditId),
    index("reel_briefs_owner_idx").on(t.ownerId),
  ],
);
