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
    method: "rules-v1",
    llm: false,
    model: "none",
    fields: [
      "contentCategory",
      "intent",
      "sentiment",
      "urgency",
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
    method: "rules-v1",
    llm: false,
    enabledByDefault: false,
    fallback: "local rules-v1 annotation",
  },
} as const;

type SourceRegistry = {
  sources: Array<{
    id: string;
    type: SourceType;
    label: string;
    target: string;
    period: "day" | "week" | "month";
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
    return record.digest.sourceCount >= 2 && quality.genericRisk !== "high" && quality.repeatedSignalCount >= 2;
  });
}

export function acceptedRefreshRecordsForDate(records: ProductFlowRefreshRecord[], date: string) {
  return latestRefreshRecords(records.filter((record) => recordDate(record) === date)).filter((record) => {
    const quality = communityDigestEvidenceQuality(record.digest);
    return record.digest.sourceCount >= 2 && quality.genericRisk !== "high" && quality.repeatedSignalCount >= 2;
  });
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
  const annotations = await annotateTexts(texts, options);
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
