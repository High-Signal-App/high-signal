import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  annotateTexts,
  annotateLightweightNlp,
  communityDigestEvidenceQuality,
  type AnnotationClientOptions,
  type CommunityDigestSnapshot,
  type LightweightNlpAnnotation,
  type LightweightIntent,
  type LightweightSentiment,
  type SignalContentCategory,
} from "@high-signal/shared";
import sourceRegistry from "../../../../data/personal-source-registry.json";
import bundledRefreshes from "../data/daily-source-refreshes.json";

const DATA_ROOT = resolve(process.cwd(), "../../data");

type SourceType = "reddit" | "hacker-news" | "github-issues" | "rss";

export const DAILY_INTELLIGENCE_LAYER = {
  version: "daily-intelligence-v1",
  sourceGate: "latest snapshot with >=2 sources, repeated signals, and non-high generic risk",
  broadReadAnnotation: {
    method: "semantic-rules-v2",
    llm: false,
    model: "none",
    fields: [
      "contentCategory",
      "intent",
      "sentiment",
      "urgency",
      "signalLayer",
      "domains",
      "painScore",
      "buyerIntentScore",
      "actionabilityScore",
      "productRequirement",
      "audience",
      "requirementType",
      "decisionStage",
      "opportunityScore",
      "qualityGate",
      "qualityScore",
      "annotation.method",
      "annotation.model",
      "annotation.intentScore",
      "annotation.sentimentScore",
    ],
  },
  batchEscalation: {
    method: "python-semantic-nlp",
    llm: false,
    optionalHuggingFace: true,
    enabledByDefault: false,
  },
  edgeAnnotationService: {
    env: "HIGH_SIGNAL_ANNOTATION_ENDPOINT",
    method: "semantic-rules-v2",
    llm: false,
    enabledByDefault: false,
    fallback: "local semantic-rules-v2 annotation",
  },
} as const;

type SourceRegistry = {
  sources: Array<{
    id: string;
    type: SourceType;
    label: string;
    target: string;
    period: "day" | "week" | "month";
    query?: string;
    intent: string;
  }>;
};

export type ProductFlowRefreshRecord = {
  source: SourceType;
  sourceId?: string;
  label?: string;
  target?: string;
  period: "day" | "week" | "month";
  digest: CommunityDigestSnapshot;
  createdAt: string;
  refreshStatus?: "accepted" | "rejected";
  refreshReason?: string;
  refreshError?: string;
};

export type DailyBroadInsight = {
  id: string;
  title: string;
  summary: string;
  href: string;
  sourceLabel: string;
  sourceType: SourceType;
  contentCategory: SignalContentCategory;
  intent: LightweightIntent;
  sentiment: LightweightSentiment;
  urgency: "low" | "medium" | "high";
  annotation: LightweightNlpAnnotation;
  confidence: "low" | "medium" | "high";
  qualityScore: number;
  sourceCount: number;
  repeatedSignalCount: number;
  observedAt: string;
};

export type DailySourceCoverage = {
  configuredSources: number;
  acceptedSnapshots: number;
  underlyingItems: number;
  latestRefreshDate: string | null;
  configuredByType: Array<{ k: SourceType; n: number }>;
  acceptedByType: Array<{ k: SourceType; n: number }>;
};

export type DailyAnnotationOptions = AnnotationClientOptions;

export type DailyAnnotationRuntime = {
  activePath: "cloudflare-service-binding" | "public-http-endpoint" | "local-typescript-fallback";
  serviceBindingConfigured: boolean;
  endpointConfigured: boolean;
  method: "semantic-rules-v2";
  llm: false;
  model: "none";
  huggingFaceBatchAvailable: boolean;
  huggingFaceEnabledByDefault: false;
  fallback: "local semantic-rules-v2 annotation";
};

type FetchBinding = { fetch: typeof fetch };

export type SourceQualityStatus = "accepted" | "rejected" | "missing";

export type SourceQualityRow = {
  sourceId: string;
  label: string;
  sourceType: SourceType;
  sourceClass: string;
  status: SourceQualityStatus;
  snapshotDate: string | null;
  sourceCount: number;
  repeatedSignalCount: number;
  genericRisk: "low" | "medium" | "high" | "missing";
  reasons: string[];
  noiseFlags: string[];
  title: string | null;
};

export type DailySourceQualityAudit = {
  date: string;
  configuredSources: number;
  observedSnapshots: number;
  acceptedSnapshots: number;
  rejectedSnapshots: number;
  missingSources: number;
  acceptedUnderlyingItems: number;
  rejectedUnderlyingItems: number;
  rejectedReasons: Array<{ k: string; n: number }>;
  statusByClass: Array<{ k: string; accepted: number; rejected: number; missing: number }>;
  actions: SourceQualityAction[];
  rows: SourceQualityRow[];
};

export type SourceQualityAction = {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  affectedSources: string[];
};

function recordDate(record: ProductFlowRefreshRecord) {
  return record.digest.snapshotDate.slice(0, 10);
}

function countBy<T extends string>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

function sourceClass(source: SourceRegistry["sources"][number]) {
  const id = source.id.toLowerCase();
  const text = `${source.label} ${source.target} ${source.query ?? ""} ${source.intent}`.toLowerCase();
  if (/india|bangalore|mumbai|delhi|nyc|bayarea|london|toronto|regional/.test(id) || /regional|city|local constraints/.test(text)) {
    return "regional";
  }
  if (
    /smallbusiness|small-business|ecommerce|shopify|etsy|freelance|seller|merchant|marketing|sales|accounting|creator/.test(id) ||
    /small business|ecommerce|shopify|etsy|freelance|seller|merchant|marketing|sales|accounting|creator/.test(text)
  ) {
    return "small-business";
  }
  if (/personalfinance|povertyfinance|jobs|consumer/.test(id) || /consumer|budget|affordability|labor market|jobs/.test(text)) {
    return "public-consumer";
  }
  if (
    /saas|startup|sideproject|entrepreneur|indiehackers|productmanagement|product-validation/.test(id) ||
    /startup|validation|launch|distribution|product management|roadmap|prioritization/.test(text)
  ) {
    return "startup-builder";
  }
  if (/market|stripe|payments|commerce|cloudflare|github|google|openai|anthropic|rss-/.test(id)) {
    return "platform-primary";
  }
  return "ai-dev";
}

export async function readSourceRefreshes(): Promise<ProductFlowRefreshRecord[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, "product-flow-refresh.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProductFlowRefreshRecord);
  } catch {
    return bundledRefreshes as ProductFlowRefreshRecord[];
  }
}

export function latestRefreshRecords(records: ProductFlowRefreshRecord[]) {
  const latest = new Map<string, ProductFlowRefreshRecord>();
  for (const record of records) {
    const key = `${record.sourceId ?? record.label ?? record.target ?? record.source}:${record.period}`.toLowerCase();
    const previous = latest.get(key);
    if (!previous || record.digest.snapshotDate > previous.digest.snapshotDate) latest.set(key, record);
  }
  return Array.from(latest.values());
}

export function acceptedRefreshRecords(records: ProductFlowRefreshRecord[]) {
  return latestRefreshRecords(records).filter((record) => {
    const quality = communityDigestEvidenceQuality(record.digest);
    return (
      record.refreshStatus !== "rejected" &&
      record.digest.sourceCount >= 2 &&
      quality.genericRisk !== "high" &&
      quality.repeatedSignalCount >= 2
    );
  });
}

export function acceptedRefreshRecordsForDate(records: ProductFlowRefreshRecord[], date: string) {
  return latestRefreshRecords(records.filter((record) => recordDate(record) === date)).filter((record) => {
    const quality = communityDigestEvidenceQuality(record.digest);
    return (
      record.refreshStatus !== "rejected" &&
      record.digest.sourceCount >= 2 &&
      quality.genericRisk !== "high" &&
      quality.repeatedSignalCount >= 2
    );
  });
}

function sourceKey(source: SourceRegistry["sources"][number]) {
  return `${source.id}:${source.period}`.toLowerCase();
}

function recordSourceKey(record: ProductFlowRefreshRecord) {
  return `${record.sourceId ?? record.label ?? record.target ?? record.source}:${record.period}`.toLowerCase();
}

function rejectionReasons(record: ProductFlowRefreshRecord) {
  const quality = communityDigestEvidenceQuality(record.digest);
  const reasons: string[] = [];
  if (record.refreshReason) reasons.push(record.refreshReason);
  if (record.refreshError) reasons.push("fetch-error");
  if (record.digest.sourceCount < 2) reasons.push("too-few-underlying-items");
  if (quality.genericRisk === "high") reasons.push("high-generic-risk");
  if (quality.repeatedSignalCount < 2) reasons.push("low-product-repeat");
  reasons.push(...quality.noiseFlags);
  return Array.from(new Set(reasons));
}

function sourceRowForRecord(source: SourceRegistry["sources"][number], record: ProductFlowRefreshRecord): SourceQualityRow {
  const quality = communityDigestEvidenceQuality(record.digest);
  const reasons = rejectionReasons(record);
  const status: SourceQualityStatus = record.refreshStatus === "rejected" || reasons.length > 0 ? "rejected" : "accepted";
  return {
    sourceId: source.id,
    label: source.label,
    sourceType: source.type,
    sourceClass: sourceClass(source),
    status,
    snapshotDate: record.digest.snapshotDate,
    sourceCount: record.digest.sourceCount,
    repeatedSignalCount: quality.repeatedSignalCount,
    genericRisk: quality.genericRisk,
    reasons,
    noiseFlags: quality.noiseFlags,
    title: record.digest.summary?.keyTrend?.title ?? record.digest.summaryText ?? null,
  };
}

function missingSourceRow(source: SourceRegistry["sources"][number]): SourceQualityRow {
  return {
    sourceId: source.id,
    label: source.label,
    sourceType: source.type,
    sourceClass: sourceClass(source),
    status: "missing",
    snapshotDate: null,
    sourceCount: 0,
    repeatedSignalCount: 0,
    genericRisk: "missing",
    reasons: ["no-snapshot-for-date"],
    noiseFlags: [],
    title: null,
  };
}

function topLabels(rows: SourceQualityRow[], limit = 5) {
  return rows.slice(0, limit).map((row) => row.label);
}

function buildSourceQualityActions(input: {
  configuredSources: number;
  accepted: SourceQualityRow[];
  rejected: SourceQualityRow[];
  missing: SourceQualityRow[];
  rejectedReasons: Array<{ k: string; n: number }>;
  statusByClass: Array<{ k: string; accepted: number; rejected: number; missing: number }>;
}): SourceQualityAction[] {
  const actions: SourceQualityAction[] = [];
  const missingRatio = input.missing.length / Math.max(1, input.configuredSources);
  if (input.missing.length > 0) {
    const topMissingClasses = input.statusByClass
      .filter((item) => item.missing > 0)
      .sort((a, b) => b.missing - a.missing || a.k.localeCompare(b.k))
      .slice(0, 3)
      .map((item) => `${item.k} ${item.missing}`)
      .join(" / ");
    actions.push({
      priority: missingRatio >= 0.25 ? "high" : "medium",
      title: "Refresh missing source snapshots",
      detail: `${input.missing.length} configured source(s) have no accepted-or-rejected snapshot for this date. Missing classes: ${topMissingClasses || "none"}.`,
      affectedSources: topLabels(input.missing),
    });
  }
  if (input.rejected.length > 0) {
    actions.push({
      priority: input.rejected.length >= 5 ? "high" : "medium",
      title: "Inspect rejected source snapshots",
      detail: input.rejectedReasons
        .slice(0, 4)
        .map(({ k, n }) => `${k.replaceAll("-", " ")} ${n}`)
        .join(" / "),
      affectedSources: topLabels(input.rejected),
    });
  }
  for (const item of input.statusByClass) {
    if (item.accepted === 0 && item.rejected + item.missing > 0) {
      const affected = [...input.rejected, ...input.missing]
        .filter((row) => row.sourceClass === item.k)
        .map((row) => row.label)
        .slice(0, 5);
      actions.push({
        priority: "high",
        title: `Restore ${item.k} coverage`,
        detail: `${item.k} has zero accepted source snapshots for this date (${item.rejected} rejected, ${item.missing} missing).`,
        affectedSources: affected,
      });
    } else if (item.accepted === 1 && item.rejected + item.missing >= 3) {
      const affected = [...input.rejected, ...input.missing]
        .filter((row) => row.sourceClass === item.k)
        .map((row) => row.label)
        .slice(0, 5);
      actions.push({
        priority: "medium",
        title: `Improve ${item.k} redundancy`,
        detail: `${item.k} has only one accepted snapshot while ${item.rejected + item.missing} configured source(s) are unavailable or rejected.`,
        affectedSources: affected,
      });
    }
  }
  if (!actions.length) {
    actions.push({
      priority: "low",
      title: "Coverage gate healthy",
      detail: "All configured source groups have accepted coverage and no rejected snapshots for this date.",
      affectedSources: [],
    });
  }
  return actions
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title);
    })
    .slice(0, 6);
}

export function buildDailySourceQualityAudit(records: ProductFlowRefreshRecord[], date: string): DailySourceQualityAudit {
  const registry = sourceRegistry as SourceRegistry;
  const dateRecords = latestRefreshRecords(records.filter((record) => recordDate(record) === date));
  const recordsByKey = new Map(dateRecords.map((record) => [recordSourceKey(record), record]));
  const rows = registry.sources.map((source) => {
    const record = recordsByKey.get(sourceKey(source));
    return record ? sourceRowForRecord(source, record) : missingSourceRow(source);
  });
  const accepted = rows.filter((row) => row.status === "accepted");
  const rejected = rows.filter((row) => row.status === "rejected");
  const missing = rows.filter((row) => row.status === "missing");
  const classMap = new Map<string, { k: string; accepted: number; rejected: number; missing: number }>();
  for (const row of rows) {
    const item = classMap.get(row.sourceClass) ?? { k: row.sourceClass, accepted: 0, rejected: 0, missing: 0 };
    item[row.status] += 1;
    classMap.set(row.sourceClass, item);
  }
  const rejectedReasons = countBy(rejected.flatMap((row) => row.reasons));
  const statusByClass = Array.from(classMap.values()).sort((a, b) => a.k.localeCompare(b.k));
  return {
    date,
    configuredSources: registry.sources.length,
    observedSnapshots: dateRecords.length,
    acceptedSnapshots: accepted.length,
    rejectedSnapshots: rejected.length,
    missingSources: missing.length,
    acceptedUnderlyingItems: accepted.reduce((sum, row) => sum + row.sourceCount, 0),
    rejectedUnderlyingItems: rejected.reduce((sum, row) => sum + row.sourceCount, 0),
    rejectedReasons,
    statusByClass,
    actions: buildSourceQualityActions({
      configuredSources: registry.sources.length,
      accepted,
      rejected,
      missing,
      rejectedReasons,
      statusByClass,
    }),
    rows: rows.sort(
      (a, b) =>
        (a.status === "accepted" ? 0 : a.status === "rejected" ? 1 : 2) -
          (b.status === "accepted" ? 0 : b.status === "rejected" ? 1 : 2) ||
        a.sourceClass.localeCompare(b.sourceClass) ||
        a.label.localeCompare(b.label),
    ),
  };
}

export function acceptedRefreshDates(records: ProductFlowRefreshRecord[]) {
  const candidateDates = new Set(records.map(recordDate));
  return Array.from(candidateDates)
    .filter((date) => acceptedRefreshRecordsForDate(records, date).length > 0)
    .sort((a, b) => b.localeCompare(a));
}

export function resolveAcceptedRefreshDate(records: ProductFlowRefreshRecord[], preferredDate?: string | null) {
  const dates = acceptedRefreshDates(records);
  if (!dates.length) return null;
  if (!preferredDate) return dates[0] ?? null;
  if (dates.includes(preferredDate)) return preferredDate;
  return dates.find((date) => date < preferredDate) ?? dates[0] ?? null;
}

function classifyBroadInsight(record: ProductFlowRefreshRecord): SignalContentCategory {
  const text = `${record.sourceId ?? ""} ${record.label ?? ""} ${record.target ?? ""} ${record.digest.promptUsed} ${record.digest.summaryText}`.toLowerCase();
  if (/\b(india|bangalore|mumbai|delhi|nyc|bayarea|regional|local|rent|traffic|housing|pollution|permit)\b/.test(text)) {
    return "regional-issue";
  }
  if (/\b(shopify|etsy|smallbusiness|ecommerce|freelance|cashflow|invoice|customer|fulfillment|inventory|reviews|checkout)\b/.test(text)) {
    return "customer-complaint";
  }
  if (/\b(startup|saas|sideproject|product hunt|launch|pricing|distribution|validation|funding)\b/.test(text)) {
    return "startup-move";
  }
  if (/\b(agent|llm|openai|claude|citation|provenance|retrieval|mcp|evaluation)\b/.test(text)) {
    return "agent-evaluation";
  }
  if (/\b(github|developer|devops|webdev|debug|workflow|issue|deploy|observability)\b/.test(text)) {
    return "product-opportunity";
  }
  return "product-opportunity";
}

function qualityScore(record: ProductFlowRefreshRecord) {
  const quality = communityDigestEvidenceQuality(record.digest);
  const sourceScore = Math.min(record.digest.sourceCount, 10) * 5;
  const repeatScore = Math.min(quality.repeatedSignalCount, 5) * 10;
  const riskPenalty = quality.genericRisk === "low" ? 0 : quality.genericRisk === "medium" ? 12 : 35;
  return Math.max(0, Math.min(100, sourceScore + repeatScore + 20 - riskPenalty));
}

function annotationText(record: ProductFlowRefreshRecord) {
  const keyTrend = record.digest.summary?.keyTrend;
  const summary = keyTrend?.desc ?? record.digest.summaryText;
  return `${keyTrend?.title ?? ""} ${summary} ${record.digest.promptUsed ?? ""}`;
}

function buildDailyBroadInsight(record: ProductFlowRefreshRecord, annotation: LightweightNlpAnnotation): DailyBroadInsight {
  const quality = communityDigestEvidenceQuality(record.digest);
  const score = qualityScore(record);
  const keyTrend = record.digest.summary?.keyTrend;
  const label = record.label ?? record.sourceId ?? record.target ?? record.source;
  const summary = keyTrend?.desc ?? record.digest.summaryText;
  return {
    id: `${record.sourceId ?? label}-${record.digest.snapshotDate}`,
    title: keyTrend?.title ?? `${label}: ${classifyBroadInsight(record).replaceAll("-", " ")}`,
    summary,
    href: keyTrend?.link ?? `/personal#${encodeURIComponent(record.sourceId ?? label)}`,
    sourceLabel: label,
    sourceType: record.source,
    contentCategory: classifyBroadInsight(record),
    intent: annotation.intent,
    sentiment: annotation.sentiment,
    urgency: annotation.urgency,
    annotation,
    confidence: record.digest.sourceCount >= 8 ? "high" : record.digest.sourceCount >= 3 ? "medium" : "low",
    qualityScore: score,
    sourceCount: record.digest.sourceCount,
    repeatedSignalCount: quality.repeatedSignalCount,
    observedAt: record.digest.snapshotDate,
  };
}

function sortBroadInsights(insights: DailyBroadInsight[]) {
  return insights.sort((a, b) => b.qualityScore - a.qualityScore || b.observedAt.localeCompare(a.observedAt));
}

export function buildDailyBroadInsights(records: ProductFlowRefreshRecord[], date: string) {
  return sortBroadInsights(
    acceptedRefreshRecordsForDate(records, date).map((record) =>
      buildDailyBroadInsight(record, annotateLightweightNlp(annotationText(record))),
    ),
  );
}

export async function buildDailyBroadInsightsWithAnnotations(
  records: ProductFlowRefreshRecord[],
  date: string,
  options: DailyAnnotationOptions = {},
) {
  const accepted = acceptedRefreshRecordsForDate(records, date);
  const texts = accepted.map(annotationText);
  const annotations = await annotateTexts(texts, await resolveDailyAnnotationOptions(options));
  return sortBroadInsights(
    accepted.map((record, index) =>
      buildDailyBroadInsight(record, annotations[index] ?? annotateLightweightNlp(texts[index] ?? "")),
    ),
  );
}

export function defaultDailyAnnotationOptions(): DailyAnnotationOptions {
  return {
    endpoint: process.env["HIGH_SIGNAL_ANNOTATION_ENDPOINT"] ?? null,
  };
}

async function getAnnotationBinding(): Promise<FetchBinding | null> {
  if (typeof process === "undefined") return null;
  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = (
      mod as unknown as {
        getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
      }
    ).getCloudflareContext?.();
    const annotation = ctx?.env?.["ANNOTATION"];
    if (annotation && typeof (annotation as { fetch?: unknown }).fetch === "function") {
      return annotation as FetchBinding;
    }
  } catch {
    /* not in Worker context */
  }
  return null;
}

async function resolveDailyAnnotationOptions(options: DailyAnnotationOptions): Promise<DailyAnnotationOptions> {
  if (options.endpoint || options.fetcher) return options;
  const binding = await getAnnotationBinding();
  if (!binding) return defaultDailyAnnotationOptions();
  return {
    endpoint: "https://annotation/annotate",
    fetcher: (input, init) => binding.fetch(input, init),
    timeoutMs: options.timeoutMs,
  };
}

export async function dailyAnnotationRuntime(): Promise<DailyAnnotationRuntime> {
  const serviceBindingConfigured = Boolean(await getAnnotationBinding());
  const endpointConfigured = Boolean(process.env["HIGH_SIGNAL_ANNOTATION_ENDPOINT"]?.trim());
  return {
    activePath: serviceBindingConfigured
      ? "cloudflare-service-binding"
      : endpointConfigured
        ? "public-http-endpoint"
        : "local-typescript-fallback",
    serviceBindingConfigured,
    endpointConfigured,
    method: "semantic-rules-v2",
    llm: false,
    model: "none",
    huggingFaceBatchAvailable: true,
    huggingFaceEnabledByDefault: false,
    fallback: "local semantic-rules-v2 annotation",
  };
}

export function buildDailySourceCoverage(records: ProductFlowRefreshRecord[], date?: string): DailySourceCoverage {
  const registry = sourceRegistry as SourceRegistry;
  const accepted = date ? acceptedRefreshRecordsForDate(records, date) : acceptedRefreshRecords(records);
  const latestRefreshDate =
    accepted
      .map((record) => record.digest.snapshotDate)
      .sort()
      .at(-1)
      ?.slice(0, 10) ?? null;
  return {
    configuredSources: registry.sources.length,
    acceptedSnapshots: accepted.length,
    underlyingItems: accepted.reduce((sum, record) => sum + record.digest.sourceCount, 0),
    latestRefreshDate,
    configuredByType: countBy(registry.sources.map((source) => source.type)),
    acceptedByType: countBy(accepted.map((record) => record.source)),
  };
}
