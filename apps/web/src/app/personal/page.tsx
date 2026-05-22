import {
  BackLink,
  FeedList,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import { api, type SignalRow } from "@/lib/api";
import {
  buildDailyBroadInsightsWithAnnotations,
  buildDailySourceCoverage,
  buildDailySourceQualityAudit,
  dailyAnnotationRuntime,
  DAILY_INTELLIGENCE_LAYER,
  defaultDailyAnnotationOptions,
  readSourceRefreshes as readBundledSourceRefreshes,
  resolveAcceptedRefreshDate,
} from "@/lib/daily-intelligence";
import {
  dailyReadMatches,
  dailyReadQuery,
  READ_DOMAINS,
  READ_SIGNAL_LAYERS,
  safeReadDomain,
  safeReadLayer,
} from "@/lib/daily-read-filters";
import { buildDailyRequirementQueue } from "@/lib/daily-requirements";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import marketWatch from "../../../../../data/personal-market-watch.json";
import productGraph from "../../../../../data/personal-product-graph.json";
import reportIndex from "../../../../../data/personal-report-index.json";
import {
  buildPersonalCommandBrief,
  communityDigestEvidenceQuality,
  evidenceFromMarketRefreshes,
  evidenceFromMarketWatchConfig,
  generateProductOpportunities,
  type CommunityDigestSnapshot,
  type IdeaFlowEvidence,
  type MarketRefreshRecord,
  type MarketWatchConfig,
  type PersonalBriefSnapshot,
  type PersonalRecommendationDecision,
  type PersonalProductProfile,
  type PersonalRecommendationFeedback,
  type PersonalTaskSyncRecord,
  type SignalContentCategory,
} from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personal Command Brief — High Signal" };
const DATA_ROOT = resolve(process.cwd(), "../../data");

type ProductFlowRefreshRecord = {
  source: "reddit" | "hacker-news" | "github-issues" | "rss";
  sourceId?: string;
  label?: string;
  target?: string;
  subreddit?: string;
  period: "day" | "week" | "month";
  prompt?: string;
  digest: CommunityDigestSnapshot;
  createdAt: string;
  refreshStatus?: "accepted" | "rejected";
  refreshReason?: string;
  refreshError?: string;
};

type PersonalReportIndex = {
  updatedAt: string;
  reports: Array<{
    date: string;
    generatedAt: string | null;
    usefulness: string | null;
    recommendations: string | null;
    latestEvidence: string | null;
    markdown: string;
  }>;
};

const fallbackFlows: IdeaFlowEvidence[] = [
  {
    id: "personal-agent-eval",
    source: "mention",
    title: "Agent evaluation is becoming part of product selection",
    summary:
      "Products that are not legible, cited, and evidence-backed will be filtered out by assistants and buyer agents.",
    href: "/agent-eval",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "personal-google-ai-mode-comparisons",
    source: "resource",
    title: "AI search features are built for complex comparisons",
    summary:
      "Google describes AI search features as useful for nuanced questions and comparison-style research, which raises the bar for product evidence and retrievability.",
    href: "https://developers.google.com/search/docs/appearance/ai-features",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "personal-agentic-commerce-infrastructure",
    source: "resource",
    title: "Agentic commerce requires agent-ready infrastructure",
    summary:
      "Agentic commerce shifts product selection toward agents that compare options, inspect trust signals, and need machine-readable product and policy data.",
    href: "https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "personal-code-review",
    source: "community",
    title: "Agent-written code creates review and bug-finding pressure",
    summary:
      "Developers increasingly need trustworthy review loops for code written by AI agents, especially when bugs are subtle.",
    href: "/opportunities",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "medium",
  },
  {
    id: "personal-fleet-ops",
    source: "resource",
    title: "Multi-product builders need an operating system for product decisions",
    summary:
      "A fleet of small products needs ranked build/change/watch decisions, not more disconnected dashboards.",
    href: "/watchlist",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
];

function signalTitle(signal: SignalRow) {
  const firstLine = signal.bodyMd.split("\n").find((line) => line.trim()) ?? signal.slug;
  return firstLine.replace(/^#\s*/, "").trim() || signal.slug;
}

function evidenceFromSignals(signals: SignalRow[]): IdeaFlowEvidence[] {
  return signals.slice(0, 25).map((signal) => ({
    id: `signal-${signal.id}`,
    source: "market" as const,
    title: signalTitle(signal),
    summary: `${signal.primaryEntityId} / ${signal.signalType.replaceAll("_", " ")} / ${signal.direction} / ${signal.confidence} confidence`,
    href: `/signals/${signal.slug}`,
    observedAt: new Date(signal.publishedAt).toISOString(),
    confidence: signal.confidence,
  }));
}

function evidenceFromDigests(digests: CommunityDigestSnapshot[]): IdeaFlowEvidence[] {
  return digests.slice(0, 20).map((digest) => ({
    id: `digest-${digest.id}`,
    source: "community" as const,
    title: digest.summary?.keyTrend?.title ?? `r/${digest.subreddit} ${digest.period} digest`,
    summary: digest.summary?.keyTrend?.desc ?? digest.summaryText,
    href: `/communities/${encodeURIComponent(digest.subreddit)}/${digest.period}`,
    observedAt: digest.snapshotDate,
    confidence: digest.sourceCount >= 8 ? "high" : digest.sourceCount >= 3 ? "medium" : "low",
    quality: communityDigestEvidenceQuality(digest),
  }));
}

function actionTone(action: string) {
  if (action === "build") return "text-[var(--color-accent)]";
  if (action === "change") return "text-amber-300";
  if (action === "watch") return "text-[var(--color-muted)]";
  return "text-red-300";
}

async function readFeedback(): Promise<PersonalRecommendationFeedback[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, "personal-feedback.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalRecommendationFeedback);
  } catch {
    return [];
  }
}

async function readDecisions(): Promise<PersonalRecommendationDecision[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, "personal-decisions.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalRecommendationDecision);
  } catch {
    return [];
  }
}

async function readTaskSync(): Promise<PersonalTaskSyncRecord[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, "personal-task-sync.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalTaskSyncRecord);
  } catch {
    return [];
  }
}

async function readSourceRefreshes(): Promise<ProductFlowRefreshRecord[]> {
  return (await readBundledSourceRefreshes()) as ProductFlowRefreshRecord[];
}

async function readMarketRefreshes(): Promise<MarketRefreshRecord[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, "personal-market-refresh.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MarketRefreshRecord);
  } catch {
    return [];
  }
}

async function readBriefSnapshots(): Promise<PersonalBriefSnapshot[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, "personal-brief-snapshots.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalBriefSnapshot);
  } catch {
    return [];
  }
}

function latestBriefSnapshot(snapshots: PersonalBriefSnapshot[]) {
  return snapshots.slice().sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

function evidenceFromRefreshes(records: ProductFlowRefreshRecord[]): IdeaFlowEvidence[] {
  return latestRefreshRecords(records)
    .filter((record) => {
      const quality = communityDigestEvidenceQuality(record.digest);
      return (
        record.refreshStatus !== "rejected" &&
        record.digest.sourceCount >= 2 &&
        quality.genericRisk !== "high" &&
        quality.repeatedSignalCount >= 2
      );
    })
    .map((record) => {
      const sourceKey = record.sourceId ?? record.subreddit ?? record.target ?? record.label ?? record.source;
      const sourceLabel = record.label ?? record.subreddit ?? record.target ?? record.source;
      const keyTrend = record.digest.summary?.keyTrend;
      return {
        id: `refresh-${sourceKey}-${record.digest.snapshotDate}`,
        source: record.source === "rss" ? ("news" as const) : ("community" as const),
        title: keyTrend?.title ?? `${sourceLabel} ${record.period} refresh`,
        summary: keyTrend?.desc ?? record.digest.summaryText,
        href: keyTrend?.link ?? `/personal#${encodeURIComponent(sourceKey)}`,
        observedAt: record.digest.snapshotDate,
        confidence: record.digest.sourceCount >= 8 ? "high" : record.digest.sourceCount >= 3 ? "medium" : "low",
        quality: communityDigestEvidenceQuality(record.digest),
      };
    });
}

function latestRefreshRecords(records: ProductFlowRefreshRecord[]) {
  const latest = new Map<string, ProductFlowRefreshRecord>();
  for (const record of records) {
    const sourceKey = record.sourceId ?? record.subreddit ?? record.target ?? record.label ?? record.source;
    const key = `${sourceKey.toLowerCase()}:${record.period}`;
    const previous = latest.get(key);
    if (!previous || record.digest.snapshotDate > previous.digest.snapshotDate) latest.set(key, record);
  }
  return Array.from(latest.values()).sort((a, b) => b.digest.snapshotDate.localeCompare(a.digest.snapshotDate));
}

function countByValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countLine(values: Array<[string, number]>) {
  return values.map(([key, value]) => `${key.replaceAll("-", " ")} ${value}`).join(" / ") || "none";
}

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function firstReportLines(markdown: string, limit = 220) {
  return markdown.split("\n").slice(0, limit).join("\n");
}

export default async function PersonalPage({
  searchParams,
}: {
  searchParams?: Promise<{
    date?: string;
    sourceDate?: string;
    readCategory?: string;
    layer?: string;
    domain?: string;
    requirement?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const reports = (reportIndex as PersonalReportIndex).reports.slice().sort((a, b) => b.date.localeCompare(a.date));
  const requestedDate = safeDate(params.date);
  const requestedSourceDate = safeDate(params.sourceDate);
  const selectedReport = reports.find((report) => report.date === requestedDate) ?? reports[0] ?? null;
  const selectedReadCategory = (params.readCategory || "") as SignalContentCategory | "";
  const selectedReadLayer = safeReadLayer(params.layer);
  const selectedReadDomain = safeReadDomain(params.domain);
  const selectedRequirement = params.requirement === "yes";
  const ownerId = productGraph.owner;
  const [signalsResult, dashboardResult, discoverResult] = await Promise.allSettled([
    api.signals({ status: "published" }),
    api.productDashboard(ownerId),
    api.productCommunityDiscover("week"),
  ]);
  const signals = signalsResult.status === "fulfilled" ? signalsResult.value.signals : [];
  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const discover = discoverResult.status === "fulfilled" ? discoverResult.value.items : [];
  const refreshes = await readSourceRefreshes();
  const marketRefreshes = await readMarketRefreshes();
  const sourceReadDate =
    resolveAcceptedRefreshDate(refreshes, requestedSourceDate ?? requestedDate ?? selectedReport?.date) ??
    new Date().toISOString().slice(0, 10);
  const sourceCoverage = buildDailySourceCoverage(refreshes, sourceReadDate);
  const sourceQualityAudit = buildDailySourceQualityAudit(refreshes, sourceReadDate);
  const sourceReadsAll = await buildDailyBroadInsightsWithAnnotations(
    refreshes,
    sourceReadDate,
    defaultDailyAnnotationOptions(),
  );
  const sourceReadFilters = {
    category: selectedReadCategory,
    layer: selectedReadLayer,
    domain: selectedReadDomain,
    requirement: selectedRequirement,
  };
  const sourceReads = sourceReadsAll.filter((item) => dailyReadMatches(item, sourceReadFilters));
  const sourceReadCategories = countByValues(
    sourceReadsAll
      .filter((item) =>
        dailyReadMatches(item, {
          layer: selectedReadLayer,
          domain: selectedReadDomain,
          requirement: selectedRequirement,
        }),
      )
      .map((item) => item.contentCategory),
  );
  const sourceReadLayers = countByValues(sourceReadsAll.map((item) => item.annotation.signalLayer));
  const sourceReadDomains = countByValues(sourceReadsAll.flatMap((item) => item.annotation.domains));
  const sourceReadIntents = countByValues(sourceReads.map((item) => item.intent));
  const sourceReadSentiments = countByValues(sourceReads.map((item) => item.sentiment));
  const sourceReadAudiences = countByValues(sourceReads.map((item) => item.annotation.audience));
  const sourceReadRequirementTypes = countByValues(sourceReads.map((item) => item.annotation.requirementType));
  const sourceReadQualityGates = countByValues(sourceReads.map((item) => item.annotation.qualityGate.status));
  const products = productGraph.products as PersonalProductProfile[];
  const requirementQueue = buildDailyRequirementQueue(sourceReads, 8, products);
  const taskExportCount = requirementQueue.filter((item) => item.taskDraft).length;
  const annotationRuntime = await dailyAnnotationRuntime();
  const evidence = [
    ...evidenceFromMarketRefreshes(marketRefreshes),
    ...evidenceFromMarketWatchConfig(marketWatch as MarketWatchConfig),
    ...evidenceFromRefreshes(refreshes),
    ...evidenceFromSignals(signals),
    ...evidenceFromDigests(discover),
    ...evidenceFromDigests(dashboard?.communities.latestDigests ?? []),
    ...fallbackFlows,
  ];
  const opportunities = generateProductOpportunities(evidence);
  const [feedback, decisions, taskSync, snapshots] = await Promise.all([
    readFeedback(),
    readDecisions(),
    readTaskSync(),
    readBriefSnapshots(),
  ]);
  const previousSnapshot = latestBriefSnapshot(snapshots);
  const brief = buildPersonalCommandBrief({
    products,
    opportunities,
    evidence,
    feedback,
    decisions,
    taskSync,
    previousSnapshot,
  });
  const pendingSync = brief.actionTasks.filter((item) => item.status === "todo" && item.syncStatus !== "created").length;
  const worldChangeItems = brief.recommendations.filter((item) => item.signalLayer === "world-change").slice(0, 6);
  const appComplaintItems = brief.recommendations.filter((item) => item.signalLayer === "app-complaint").slice(0, 6);
  const marketItems = brief.recommendations.filter((item) => item.signalLayer === "market-watch").slice(0, 6);
  const topAction = brief.topBuilds[0] ?? brief.recommendations[0] ?? null;
  const nextActions = brief.recommendations.filter((item) => item.id !== topAction?.id).slice(0, 6);
  const openTasks = brief.actionTasks.filter((item) => item.status === "todo").slice(0, 6);

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="personal command brief" title="What should I do next?">
        A decision page for your product fleet. It turns world changes, app complaints, and market
        context into a ranked action, the reason, the evidence, and the next step.
      </SectionHeader>

      <StatGrid
        items={[
          { label: "Usefulness", value: `${brief.usefulnessAudit.score}/100`, sub: brief.usefulnessAudit.readiness },
          { label: "Best action", value: topAction ? topAction.action : "none", sub: topAction?.productName ?? "no recommendation" },
          { label: "Open actions", value: brief.recommendations.length.toString(), sub: "build / change / watch" },
          { label: "Freshness", value: brief.freshness.evidenceAgeDays === null ? "?" : `${brief.freshness.evidenceAgeDays}d`, sub: "latest evidence age" },
          { label: "Evidence", value: `${brief.evidenceBreakdown.worldChange}/${brief.evidenceBreakdown.appComplaint}/${brief.evidenceBreakdown.marketWatch}`, sub: "world / complaints / markets" },
          { label: "Task sync", value: pendingSync.toString(), sub: "accepted tasks pending" },
        ]}
      />

      <div className="mt-10">
        <Panel eyebrow="source intelligence" title="What the reads layer is watching">
          <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
            Latest accepted source date: {sourceReadDate}. Labels use{" "}
            {DAILY_INTELLIGENCE_LAYER.broadReadAnnotation.method} through{" "}
            {annotationRuntime.activePath.replaceAll("-", " ")}; no LLM is used for this daily
            annotation pass. Hugging Face enrichment exists only as an optional batch path right now.
          </p>
          <form action="/personal" className="mt-5 grid gap-3 border-y border-[var(--color-line)] py-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
            <input name="date" type="hidden" value={selectedReport?.date ?? ""} />
            <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              source date
              <input
                className="border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                defaultValue={sourceReadDate}
                name="sourceDate"
                type="date"
              />
            </label>
            <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              content type
              <select
                className="border border-[var(--color-line)] bg-black px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                defaultValue={selectedReadCategory}
                name="readCategory"
              >
                <option value="">all</option>
                {sourceReadCategories.map(([category, count]) => (
                  <option key={category} value={category}>
                    {category.replaceAll("-", " ")} ({count})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              layer
              <select
                className="border border-[var(--color-line)] bg-black px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                defaultValue={selectedReadLayer}
                name="layer"
              >
                <option value="">all</option>
                {READ_SIGNAL_LAYERS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label} ({sourceReadLayers.find(([k]) => k === value)?.[1] ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              domain
              <select
                className="border border-[var(--color-line)] bg-black px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                defaultValue={selectedReadDomain}
                name="domain"
              >
                <option value="">all</option>
                {READ_DOMAINS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label} ({sourceReadDomains.find(([k]) => k === value)?.[1] ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              requirement
              <select
                className="border border-[var(--color-line)] bg-black px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                defaultValue={selectedRequirement ? "yes" : ""}
                name="requirement"
              >
                <option value="">all</option>
                <option value="yes">yes</option>
              </select>
            </label>
            <button
              className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] lg:self-end"
              type="submit"
            >
              load
            </button>
          </form>
          <MetricGrid
            items={[
              { label: "configured", value: sourceCoverage.configuredSources.toString() },
              { label: "accepted", value: sourceCoverage.acceptedSnapshots.toString() },
              { label: "rejected", value: sourceQualityAudit.rejectedSnapshots.toString() },
              { label: "missing", value: sourceQualityAudit.missingSources.toString() },
              { label: "items", value: sourceCoverage.underlyingItems.toString() },
              { label: "reads", value: sourceReads.length.toString() },
            ]}
          />
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="border border-[var(--color-line)] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                quality gate
              </div>
              <div className="mt-3 break-words font-mono text-xs leading-6 text-[var(--color-fg)]">
                {sourceQualityAudit.acceptedSnapshots} accepted / {sourceQualityAudit.rejectedSnapshots} rejected /{" "}
                {sourceQualityAudit.missingSources} missing
              </div>
            </div>
            <div className="border border-[var(--color-line)] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                reject reasons
              </div>
              <div className="mt-3 break-words font-mono text-xs leading-6 text-[var(--color-fg)]">
                {sourceQualityAudit.rejectedReasons.map(({ k, n }) => `${k.replaceAll("-", " ")} ${n}`).join(" / ") ||
                  "none"}
              </div>
            </div>
          </div>
          <div className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {sourceQualityAudit.actions.slice(0, 4).map((action) => (
              <div key={action.title} className="py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {action.priority} / source action
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--color-fg)]">{action.title}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{action.detail}</div>
                {action.affectedSources.length > 0 ? (
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    {action.affectedSources.join(" / ")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {requirementQueue.length > 0 ? (
            <div className="mt-6 border-y border-[var(--color-line)] py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  requirement queue
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:underline"
                    href={`/daily/tasks.json?${dailyReadQuery({
                      date: sourceReadDate,
                      category: selectedReadCategory,
                      layer: selectedReadLayer,
                      domain: selectedReadDomain,
                      requirement: true,
                    })}`}
                  >
                    export {taskExportCount} task{taskExportCount === 1 ? "" : "s"}
                  </a>
                  <a
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                    href={`/daily/range.json?${dailyReadQuery({
                      to: sourceReadDate,
                      days: 30,
                      category: selectedReadCategory,
                      layer: selectedReadLayer,
                      domain: selectedReadDomain,
                      requirement: true,
                      includeTasks: true,
                    })}`}
                  >
                    range 30d
                  </a>
                </div>
              </div>
              <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
                {requirementQueue.map((item) => (
                  <a key={item.id} className="block py-4 hover:text-[var(--color-accent)]" href={item.href}>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                      {item.priority} / score {item.score} / {item.suggestedBuild}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--color-fg)]">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{item.nextStep}</div>
                    {item.fleetTarget ? (
                      <div className="mt-3 border border-[var(--color-line)] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                          target {item.fleetTarget.action} / {item.fleetTarget.productName} / fit{" "}
                          {item.fleetTarget.fitScore}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--color-muted)]">
                          {item.fleetTarget.reason}. {item.fleetTarget.defaultAction}
                        </div>
                      </div>
                    ) : null}
                    {item.taskDraft ? (
                      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                        task draft / {item.taskDraft.saasMakerProjectSlug} / {item.taskDraft.status} /{" "}
                        {item.taskDraft.priority}
                      </div>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--color-muted)] md:grid-cols-2">
                      <div>
                        <span className="font-mono uppercase tracking-[0.16em]">artifact</span>{" "}
                        {item.validationArtifact}
                      </div>
                      <div>
                        <span className="font-mono uppercase tracking-[0.16em]">test</span>{" "}
                        {item.smallestTest}
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
                      {item.acceptanceCriteria[0]}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                      {item.scoreBreakdown.map((part) => (
                        <span key={part.label}>
                          {part.label.replaceAll("-", " ")} {part.contribution}/{part.max}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                      {item.domains.join("/") || "no domain"} / pain {item.painScore.toFixed(2)} / buyer{" "}
                      {item.buyerIntentScore.toFixed(2)} / action {item.actionabilityScore.toFixed(2)}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {[
              ["category", countLine(sourceReadCategories)],
              ["layer", countLine(sourceReadLayers)],
              ["domain", countLine(sourceReadDomains.slice(0, 5))],
              ["audience", countLine(sourceReadAudiences.slice(0, 5))],
              ["requirement", countLine(sourceReadRequirementTypes.slice(0, 5))],
              ["gate", countLine(sourceReadQualityGates)],
              ["intent", countLine(sourceReadIntents.slice(0, 5))],
              ["sentiment", countLine(sourceReadSentiments)],
            ].map(([label, value]) => (
              <div key={label} className="border border-[var(--color-line)] p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {label}
                </div>
                <div className="mt-3 break-words font-mono text-xs leading-6 text-[var(--color-fg)]">
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            <a
              className="block py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:underline"
              href={`/daily?${dailyReadQuery({
                date: sourceReadDate,
                category: selectedReadCategory,
                layer: selectedReadLayer,
                domain: selectedReadDomain,
                requirement: selectedRequirement,
              })}`}
            >
              open full daily read view
            </a>
            {sourceReads.slice(0, 8).map((item) => (
              <a key={item.id} className="block py-4 hover:text-[var(--color-accent)]" href={item.href}>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {item.sourceLabel} / {item.contentCategory.replaceAll("-", " ")} / intent{" "}
                  {item.intent.replaceAll("-", " ")} / {item.sentiment}
                </div>
                <div className="mt-2 text-sm leading-6">{item.title}</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  tag {item.annotation.method} / model {item.annotation.model} / intent score{" "}
                  {item.annotation.intentScore.toFixed(2)} / sentiment score{" "}
                  {item.annotation.sentimentScore.toFixed(2)} / layer{" "}
                  {item.annotation.signalLayer.replaceAll("-", " ")} / domains{" "}
                  {item.annotation.domains.join("/") || "none"} / pain{" "}
                  {item.annotation.painScore.toFixed(2)} / buyer{" "}
                  {item.annotation.buyerIntentScore.toFixed(2)} / action{" "}
                  {item.annotation.actionabilityScore.toFixed(2)} / requirement{" "}
                  {item.annotation.productRequirement ? "yes" : "no"} / audience{" "}
                  {item.annotation.audience.replaceAll("-", " ")} / type{" "}
                  {item.annotation.requirementType.replaceAll("-", " ")} / stage{" "}
                  {item.annotation.decisionStage.replaceAll("-", " ")} / opportunity{" "}
                  {item.annotation.opportunityScore.toFixed(2)} / gate{" "}
                  {item.annotation.qualityGate.status} {item.annotation.qualityGate.score}
                </div>
              </a>
            ))}
            {!sourceReads.length ? (
              <p className="py-4 text-sm text-[var(--color-muted)]">
                No accepted source reads for the latest refresh date.
              </p>
            ) : null}
          </div>
        </Panel>
      </div>

      <section className="mt-10 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
        {[
          ["1", "Do this first", topAction?.title ?? "No ranked action yet"],
          ["2", "Check why", topAction?.whyNow ?? "Need more evidence before a recommendation is useful"],
          ["3", "Use evidence", topAction ? `${topAction.evidence.length} linked source${topAction.evidence.length === 1 ? "" : "s"}` : "no evidence"],
          ["4", "Review history", selectedReport?.date ?? "no archive"],
        ].map(([step, title, body]) => (
          <div key={step} className="bg-[var(--color-bg)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              {step}
            </div>
            <div className="mt-4 text-lg font-medium">{title}</div>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{body}</p>
          </div>
        ))}
      </section>

      {topAction ? (
        <Panel
          eyebrow={`${topAction.priority} priority / ${topAction.signalLayer.replaceAll("-", " ")}`}
          title={
            <span id={topAction.id}>
              <span className={actionTone(topAction.action)}>{topAction.action}</span> /{" "}
              {topAction.productName}
            </span>
          }
        >
          <p className="mt-4 text-xl leading-8">{topAction.title}</p>
          <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
            {topAction.suggestedChange}
          </p>
          <MetricGrid
            items={[
              { label: "score", value: topAction.score.toString() },
              { label: "evidence", value: topAction.evidence.length.toString() },
              { label: "sources", value: topAction.sourceDiversity.toString() },
              { label: "decision", value: topAction.decisionStatus ?? "open" },
            ]}
          />
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                why now
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{topAction.whyNow}</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                next step
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{topAction.nextStep}</p>
            </div>
          </div>
          <div className="mt-6 border-t border-[var(--color-line)] pt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              evidence
            </div>
            <div className="mt-3 divide-y divide-[var(--color-line)]">
              {topAction.evidence.slice(0, 5).map((evidenceItem) => (
                <a
                  key={evidenceItem.id}
                  className="block py-3 hover:text-[var(--color-accent)]"
                  href={evidenceItem.href}
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    {evidenceItem.source} / {evidenceItem.confidence}
                  </div>
                  <div className="mt-1 text-sm">{evidenceItem.title}</div>
                </a>
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      {brief.freshness.warnings.length ? (
        <section className="mt-10 border-y border-[var(--color-line)]">
          <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
            freshness warnings
          </div>
          <div className="divide-y divide-[var(--color-line)]">
            {brief.freshness.warnings.map((warning) => (
              <div key={warning} className="py-4 text-sm leading-6 text-[var(--color-muted)]">
                {warning}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <FeedList
        eyebrow="next actions"
        empty="No secondary actions yet."
        items={nextActions.map((item) => ({
          href: `/personal#${item.id}`,
          kicker: `${item.productName} / ${item.action} / ${item.priority} / score ${item.score}`,
          title: item.title,
          body: item.nextStep,
        }))}
      />

      <section className="mt-10 grid gap-6 lg:grid-cols-3">
        <Panel eyebrow="world changes" title={brief.evidenceBreakdown.worldChange}>
          <div className="mt-4 divide-y divide-[var(--color-line)]">
            {worldChangeItems.slice(0, 3).map((item) => (
              <a key={item.id} className="block py-4 hover:text-[var(--color-accent)]" href={`/personal#${item.id}`}>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {item.productName} / {item.action}
                </div>
                <div className="mt-2 text-sm leading-6">{item.title}</div>
              </a>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="common complaints" title={brief.evidenceBreakdown.appComplaint}>
          <div className="mt-4 divide-y divide-[var(--color-line)]">
            {appComplaintItems.slice(0, 3).map((item) => (
              <a key={item.id} className="block py-4 hover:text-[var(--color-accent)]" href={`/personal#${item.id}`}>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {item.productName} / {item.action}
                </div>
                <div className="mt-2 text-sm leading-6">{item.title}</div>
              </a>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="market context" title={brief.evidenceBreakdown.marketWatch}>
          <div className="mt-4 divide-y divide-[var(--color-line)]">
            {marketItems.slice(0, 3).map((item) => (
              <a key={item.id} className="block py-4 hover:text-[var(--color-accent)]" href={`/personal#${item.id}`}>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {item.productName} / {item.action}
                </div>
                <div className="mt-2 text-sm leading-6">{item.title}</div>
              </a>
            ))}
          </div>
        </Panel>
      </section>

      <FeedList
        eyebrow="accepted action queue"
        empty="No accepted actions yet."
        items={openTasks.map((item) => ({
            href: `/personal#${item.recommendationId}`,
            kicker: `${item.priority} / ${item.action} / ${item.productSlug}`,
            title: item.title,
            body: `${item.nextStep} Sync: ${item.syncStatus}${item.syncedTaskId ? ` (${item.syncedTaskId})` : ""}`,
          }))}
      />

      <details className="mt-10 border-y border-[var(--color-line)] py-5">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          all recommendation details
        </summary>
        <section className="mt-6 grid gap-8">
          {brief.recommendations.map((item) => (
          <Panel
            key={item.id}
            eyebrow={`${item.priority} priority`}
            title={
              <span id={item.id}>
                <span className={actionTone(item.action)}>{item.action}</span> / {item.productName}
              </span>
            }
          >
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
              {item.suggestedChange}
            </p>
            <MetricGrid
              items={[
                { label: "score", value: item.score.toString() },
                { label: "action", value: item.action },
                { label: "evidence", value: item.evidence.length.toString() },
                { label: "feedback", value: item.feedbackAdjustment.toString() },
                { label: "decision", value: item.decisionStatus ?? "open" },
              ]}
            />
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  why now
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.whyNow}</p>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  next action
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.nextStep}</p>
              </div>
            </div>
          </Panel>
          ))}
        </section>
      </details>

      <FeedList
        eyebrow="watch items"
        empty="No watch items."
        items={brief.watchItems.map((item) => ({
          href: `/personal#${item.id}`,
          kicker: `${item.productName} / score ${item.score}`,
          title: item.title,
          body: item.suggestedChange,
        }))}
      />

      <Panel
        eyebrow="past reports"
        title={selectedReport ? `Archive / ${selectedReport.date}` : "Archive"}
      >
        <form action="/personal" className="mt-5 flex flex-col gap-3 border-y border-[var(--color-line)] py-4 md:flex-row">
          <label className="flex flex-1 flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            date
            <input
              className="border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
              defaultValue={selectedReport?.date ?? ""}
              name="date"
              pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
              placeholder="YYYY-MM-DD"
              type="date"
            />
          </label>
          <button
            className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:self-end"
            type="submit"
          >
            load
          </button>
        </form>
        {reports.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {reports.slice(0, 21).map((report) => (
              <a
                className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${
                  report.date === selectedReport?.date
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                }`}
                href={`/personal?date=${report.date}`}
                key={report.date}
              >
                {report.date}
              </a>
            ))}
          </div>
        ) : null}
        {selectedReport ? (
          <>
            <MetricGrid
              items={[
                { label: "generated", value: selectedReport.generatedAt?.slice(0, 10) ?? "unknown" },
                { label: "usefulness", value: selectedReport.usefulness ?? "unknown" },
                { label: "recommendations", value: selectedReport.recommendations ?? "unknown" },
                { label: "latest evidence", value: selectedReport.latestEvidence?.slice(0, 10) ?? "unknown" },
              ]}
            />
            <details className="mt-6 border border-[var(--color-line)] p-4">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                open report markdown
              </summary>
              <pre className="mt-4 max-h-[48rem] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[var(--color-muted)]">
                {firstReportLines(selectedReport.markdown)}
              </pre>
            </details>
          </>
        ) : (
          <p className="mt-5 text-sm text-[var(--color-muted)]">
            No generated personal reports yet. Run <code>pnpm personal:brief report</code>.
          </p>
        )}
      </Panel>

      <section className="mt-10 border-y border-[var(--color-line)]">
        <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          weekly review questions
        </div>
        <div className="divide-y divide-[var(--color-line)]">
          {brief.operatingQuestions.map((question) => (
            <div key={question} className="py-4 text-sm leading-6 text-[var(--color-muted)]">
              {question}
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
