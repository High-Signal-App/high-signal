import { api, type SignalRow } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";
import { SignalCard } from "@/components/molecules/SignalCard";
import { assessSignalQuality, type SignalContentCategory } from "@high-signal/shared";
import {
  dailyReadMatches,
  dailyReadQuery,
  hasReadOnlyFilter,
  READ_DOMAINS,
  READ_SIGNAL_LAYERS,
  safeReadDomain,
  safeReadLayer,
} from "@/lib/daily-read-filters";
import { DAILY_REQUIREMENT_GATE, buildDailyRequirementQueue } from "@/lib/daily-requirements";
import {
  buildDailyBroadInsightsWithAnnotations,
  buildDailySourceCoverage,
  buildDailySourceQualityAudit,
  dailyAnnotationRuntime,
  resolveAcceptedRefreshDate,
  DAILY_INTELLIGENCE_LAYER,
  defaultDailyAnnotationOptions,
  readSourceRefreshes,
} from "@/lib/daily-intelligence";
import productGraph from "../../../../../../data/personal-product-graph.json";
import type { PersonalProductProfile } from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Today — High Signal",
  description:
    "Signals published in the last 24 hours, sorted by confidence. The morning-coffee surface for analysts who only have time for the freshest reads.",
};

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const CATEGORY_LABELS: Record<SignalContentCategory, string> = {
  "ai-infra": "AI infra",
  "market-pulse": "market pulse",
  "product-opportunity": "product opportunities",
  "customer-complaint": "customer complaints",
  "startup-move": "startup moves",
  "regional-issue": "regional issues",
  "agent-evaluation": "agent evaluation",
  "policy-regulatory": "policy / regulatory",
  "company-event": "company events",
};
function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

function signalCategory(signal: SignalRow): SignalContentCategory {
  return (
    signal.contentCategory ??
    assessSignalQuality({
      signalType: signal.signalType,
      confidence: signal.confidence,
      evidenceUrls: signal.evidenceUrls,
      bodyMd: signal.bodyMd,
    }).contentCategory
  );
}

function signalQuality(signal: SignalRow) {
  return assessSignalQuality({
    signalType: signal.signalType,
    confidence: signal.confidence,
    evidenceUrls: signal.evidenceUrls,
    bodyMd: signal.bodyMd,
  });
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export default async function SignalsTodayPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; category?: string; layer?: string; domain?: string; requirement?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedDate = safeDate(params.date);
  const selectedCategory = (params.category || "") as SignalContentCategory | "";
  const selectedLayer = safeReadLayer(params.layer);
  const selectedDomain = safeReadDomain(params.domain);
  const selectedRequirement = params.requirement === "yes";
  const readFilters = {
    category: selectedCategory,
    layer: selectedLayer,
    domain: selectedDomain,
    requirement: selectedRequirement,
  };
  const hasReadFilter = hasReadOnlyFilter(readFilters);
  let all: SignalRow[] = [];
  try {
    const r = await api.signals({ date: selectedDate, limit: 200 });
    all = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* offline */
  }
  const refreshes = await readSourceRefreshes();
  const sourceReadDate = resolveAcceptedRefreshDate(refreshes, selectedDate) ?? selectedDate;
  const allBroadInsights = await buildDailyBroadInsightsWithAnnotations(
    refreshes,
    sourceReadDate,
    defaultDailyAnnotationOptions(),
  );

  const today = (hasReadFilter ? [] : all)
    .filter((s) => !selectedCategory || signalCategory(s) === selectedCategory)
    .sort((a, b) => {
      const c = (CONFIDENCE_RANK[a.confidence] ?? 9) - (CONFIDENCE_RANK[b.confidence] ?? 9);
      if (c !== 0) return c;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  const broadInsights = allBroadInsights.filter((item) => dailyReadMatches(item, readFilters));
  const totalItems = today.length + broadInsights.length;
  const allItemsCount = all.length + allBroadInsights.length;
  const categories = countBy([
    ...(hasReadFilter ? [] : all.map((signal) => signalCategory(signal))),
    ...allBroadInsights
      .filter((item) =>
        dailyReadMatches(item, {
          layer: selectedLayer,
          domain: selectedDomain,
          requirement: selectedRequirement,
        }),
      )
      .map((item) => item.contentCategory),
  ]);
  const layerCounts = countBy(allBroadInsights.map((item) => item.annotation.signalLayer));
  const domainCounts = countBy(allBroadInsights.flatMap((item) => item.annotation.domains));
  const audienceCounts = countBy(broadInsights.map((item) => item.annotation.audience));
  const requirementTypeCounts = countBy(broadInsights.map((item) => item.annotation.requirementType));
  const qualityGateCounts = countBy(broadInsights.map((item) => item.annotation.qualityGate.status));
  const quality = today.map(signalQuality);
  const sourceClasses = countBy([
    ...quality.flatMap((item) => item.sourceClasses),
    ...broadInsights.map((item) => item.sourceType),
  ]);
  const usable =
    quality.filter((item) => item.publishable).length +
    broadInsights.filter((item) => item.qualityScore >= 45).length;
  const strong =
    quality.filter((item) => item.band === "strong").length +
    broadInsights.filter((item) => item.qualityScore >= 70).length;
  const evidenceCount =
    today.reduce((sum, signal) => sum + signal.evidenceUrls.length, 0) +
    broadInsights.reduce((sum, item) => sum + item.sourceCount, 0);
  const coverage = buildDailySourceCoverage(refreshes, sourceReadDate);
  const sourceQualityAudit = buildDailySourceQualityAudit(refreshes, sourceReadDate);
  const sourceDateShifted = sourceReadDate !== selectedDate;
  const products = productGraph.products as PersonalProductProfile[];
  const requirementQueue = buildDailyRequirementQueue(broadInsights, 6, products);
  const taskExportCount = requirementQueue.filter((item) => item.taskDraft).length;
  const annotationRuntime = await dailyAnnotationRuntime();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <a
        href="/signals"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← all signals
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Daily</h1>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {selectedDate} · {totalItems} item{totalItems === 1 ? "" : "s"} · signals{" "}
          {today.length} · reads {broadInsights.length}
        </p>
        {sourceDateShifted ? (
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            No accepted source-read snapshot exists for {selectedDate}; showing reads from{" "}
            {sourceReadDate}.
          </p>
        ) : null}
      </header>

      <form className="mt-6 grid gap-3 border-y border-zinc-800 py-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          date
          <input
            className="border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedDate}
            name="date"
            type="date"
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          kind
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedCategory}
            name="category"
          >
            <option value="">all</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          layer
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedLayer}
            name="layer"
          >
            <option value="">all</option>
            {READ_SIGNAL_LAYERS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label} ({layerCounts.find(([k]) => k === value)?.[1] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          domain
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedDomain}
            name="domain"
          >
            <option value="">all</option>
            {READ_DOMAINS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label} ({domainCounts.find(([k]) => k === value)?.[1] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          requirement
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedRequirement ? "yes" : ""}
            name="requirement"
          >
            <option value="">all</option>
            <option value="yes">yes</option>
          </select>
        </label>
        <button
          className="border border-zinc-800 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] lg:self-end"
          type="submit"
        >
          load
        </button>
      </form>

      <section className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-5">
        {[
          ["usable", `${usable}/${totalItems}`],
          ["strong", strong.toString()],
          ["evidence", evidenceCount.toString()],
          ["gate", `${sourceQualityAudit.acceptedSnapshots} ok / ${sourceQualityAudit.rejectedSnapshots} reject / ${sourceQualityAudit.missingSources} missing`],
          ["sources", sourceClasses.map(([k, n]) => `${k} ${n}`).join(" / ") || "none"],
        ].map(([label, value]) => (
          <div key={label} className="bg-black p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {label}
            </div>
            <div className="mt-3 break-words font-mono text-sm text-zinc-200">{value}</div>
          </div>
        ))}
      </section>

      <section className="mt-6 border-y border-zinc-800 py-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          source coverage
        </div>
        <div className="mt-4 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-6">
          {[
            ["configured", coverage.configuredSources.toString()],
            ["accepted", coverage.acceptedSnapshots.toString()],
            ["rejected", sourceQualityAudit.rejectedSnapshots.toString()],
            ["missing", sourceQualityAudit.missingSources.toString()],
            ["underlying items", coverage.underlyingItems.toString()],
            ["latest refresh", coverage.latestRefreshDate ?? "none"],
          ].map(([label, value]) => (
            <div key={label} className="bg-black p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {label}
              </div>
              <div className="mt-3 break-words font-mono text-sm text-zinc-200">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 sm:grid-cols-2">
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">configured</div>
            <div className="mt-1 font-mono">
              {coverage.configuredByType.map(({ k, n }) => `${k} ${n}`).join(" / ")}
            </div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">accepted latest</div>
            <div className="mt-1 font-mono">
              {coverage.acceptedByType.map(({ k, n }) => `${k} ${n}`).join(" / ") || "none"}
            </div>
          </div>
        </div>
        <div className="mt-5 border-t border-zinc-900 pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            quality gate
          </div>
          <div className="mt-2 grid gap-4 text-xs leading-6 text-zinc-500 sm:grid-cols-2">
            <div>
              <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">reject reasons</div>
              <div className="mt-1 font-mono">
                {sourceQualityAudit.rejectedReasons.map(({ k, n }) => `${k.replaceAll("-", " ")} ${n}`).join(" / ") || "none"}
              </div>
            </div>
            <div>
              <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">by class</div>
              <div className="mt-1 font-mono">
                {sourceQualityAudit.statusByClass
                  .map(({ k, accepted, rejected, missing }) => `${k} ${accepted}/${rejected}/${missing}`)
                  .join(" / ")}
              </div>
            </div>
          </div>
          {sourceQualityAudit.rejectedSnapshots > 0 ? (
            <div className="mt-4 divide-y divide-zinc-900 border-t border-zinc-900">
              {sourceQualityAudit.rows
                .filter((row) => row.status === "rejected")
                .slice(0, 4)
                .map((row) => (
                  <div key={row.sourceId} className="py-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      rejected / {row.sourceClass} / {row.label}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-zinc-500">
                      {row.reasons.map((reason) => reason.replaceAll("-", " ")).join(" / ")}
                    </div>
                  </div>
                ))}
            </div>
          ) : null}
          {sourceQualityAudit.actions.length > 0 ? (
            <div className="mt-4 divide-y divide-zinc-900 border-t border-zinc-900">
              {sourceQualityAudit.actions.slice(0, 4).map((action) => (
                <div key={action.title} className="py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {action.priority} / action
                  </div>
                  <div className="mt-1 text-sm leading-5 text-zinc-300">{action.title}</div>
                  <div className="mt-1 text-xs leading-5 text-zinc-500">{action.detail}</div>
                  {action.affectedSources.length > 0 ? (
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                      {action.affectedSources.join(" / ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-5 border-t border-zinc-900 pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            intelligence layer
          </div>
          <div className="mt-2 font-mono text-[11px] leading-6 text-zinc-500">
            active {annotationRuntime.activePath.replaceAll("-", " ")} ·{" "}
            {DAILY_INTELLIGENCE_LAYER.broadReadAnnotation.method} · model none · no LLM · HF batch
            available but off by default
          </div>
          <div className="mt-3 grid gap-4 text-xs leading-6 text-zinc-500 sm:grid-cols-3">
            {[
              ["audience", audienceCounts.map(([k, n]) => `${k.replaceAll("-", " ")} ${n}`).join(" / ") || "none"],
              ["requirement type", requirementTypeCounts.map(([k, n]) => `${k.replaceAll("-", " ")} ${n}`).join(" / ") || "none"],
              ["content gate", qualityGateCounts.map(([k, n]) => `${k} ${n}`).join(" / ") || "none"],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">{label}</div>
                <div className="mt-1 font-mono">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {categories.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <a
            className={`border px-2.5 py-1 ${!selectedCategory ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-zinc-800 text-zinc-500 hover:text-zinc-200"}`}
            href={`/signals/today?${dailyReadQuery({ date: selectedDate, layer: selectedLayer, domain: selectedDomain, requirement: selectedRequirement })}`}
          >
            all {allItemsCount}
          </a>
          {categories.map(([category, count]) => (
            <a
              className={`border px-2.5 py-1 ${selectedCategory === category ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-zinc-800 text-zinc-500 hover:text-zinc-200"}`}
              href={`/signals/today?${dailyReadQuery({ date: selectedDate, category, layer: selectedLayer, domain: selectedDomain, requirement: selectedRequirement })}`}
              key={category}
            >
              {(CATEGORY_LABELS[category as SignalContentCategory] ?? category).toLowerCase()} {count}
            </a>
          ))}
        </nav>
      ) : null}

      {broadInsights.length > 0 ? (
        <section className="mt-8 border-y border-zinc-800 py-6">
          {requirementQueue.length > 0 ? (
            <div className="mb-6 border-b border-zinc-900 pb-6">
              <div className="flex items-baseline justify-between gap-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  requirement queue
                </div>
                <a
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:underline"
                  href={`/daily/tasks.json?${dailyReadQuery({
                    date: sourceReadDate,
                    category: selectedCategory,
                    layer: selectedLayer,
                    domain: selectedDomain,
                    requirement: true,
                  })}`}
                >
                  export {taskExportCount} task{taskExportCount === 1 ? "" : "s"}
                </a>
                <a
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-[var(--color-accent)]"
                  href={`/daily/history?${dailyReadQuery({
                    to: sourceReadDate,
                    days: 30,
                    category: selectedCategory,
                    layer: selectedLayer,
                    domain: selectedDomain,
                    requirement: true,
                    includeTasks: true,
                  })}`}
                >
                  history 30d
                </a>
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                gate score {DAILY_REQUIREMENT_GATE.minScore}+ / sources{" "}
                {DAILY_REQUIREMENT_GATE.minSourceCount}+ / repeats{" "}
                {DAILY_REQUIREMENT_GATE.minRepeatedSignalCount}+ / build-change only
              </div>
              <div className="mt-4 divide-y divide-zinc-900 border-y border-zinc-900">
                {requirementQueue.map((item) => (
                  <a className="block py-4 hover:text-[var(--color-accent)]" href={item.href} key={item.id}>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      <span>{item.priority}</span>
                      <span className="text-zinc-700">·</span>
                      <span>score {item.score}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{item.suggestedBuild}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{item.domains.join("/") || "no domain"}</span>
                    </div>
                    <div className="mt-2 text-base font-medium leading-snug text-zinc-100">{item.title}</div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                    {item.fleetTarget ? (
                      <div className="mt-3 border border-zinc-900 p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                          target {item.fleetTarget.action} / {item.fleetTarget.productName} / fit{" "}
                          {item.fleetTarget.fitScore}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-zinc-500">
                          {item.fleetTarget.reason}. {item.fleetTarget.defaultAction}
                        </div>
                      </div>
                    ) : null}
                    {item.taskDraft ? (
                      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                        task draft / {item.taskDraft.saasMakerProjectSlug} / {item.taskDraft.status} /{" "}
                        {item.taskDraft.priority}
                      </div>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-500 sm:grid-cols-2">
                      <div>
                        <span className="font-mono uppercase tracking-[0.16em] text-zinc-600">artifact</span>{" "}
                        {item.validationArtifact}
                      </div>
                      <div>
                        <span className="font-mono uppercase tracking-[0.16em] text-zinc-600">test</span>{" "}
                        {item.smallestTest}
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-zinc-600">{item.acceptanceCriteria[0]}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                      {item.scoreBreakdown.map((part) => (
                        <span key={part.label}>
                          {part.label.replaceAll("-", " ")} {part.contribution}/{part.max}
                        </span>
                      ))}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              broad public / startup / smb reads
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              {broadInsights.length} accepted
            </div>
          </div>
          <div className="mt-4 divide-y divide-zinc-800">
            {broadInsights.slice(0, 12).map((item) => (
              <a
                className="block py-4 hover:text-[var(--color-accent)]"
                href={item.href}
                key={item.id}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  <span>{item.sourceLabel}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{item.contentCategory.replaceAll("-", " ")}</span>
                  <span className="text-zinc-700">·</span>
                  <span>intent {item.intent.replaceAll("-", " ")}</span>
                  <span className="text-zinc-700">·</span>
                  <span>sentiment {item.sentiment}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{item.confidence}</span>
                  <span className="text-zinc-700">·</span>
                  <span>quality {item.qualityScore}</span>
                </div>
                <div className="mt-2 text-lg font-medium leading-snug text-zinc-100">{item.title}</div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{item.summary}</p>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                  <span>sources {item.sourceCount}</span>
                  <span>repeats {item.repeatedSignalCount}</span>
                  <span>tag {item.annotation.method}</span>
                  <span>model {item.annotation.model}</span>
                  <span>intent score {item.annotation.intentScore.toFixed(2)}</span>
                  <span>sentiment score {item.annotation.sentimentScore.toFixed(2)}</span>
                  <span>layer {item.annotation.signalLayer.replaceAll("-", " ")}</span>
                  <span>domains {item.annotation.domains.join("/") || "none"}</span>
                  <span>pain {item.annotation.painScore.toFixed(2)}</span>
                  <span>buyer {item.annotation.buyerIntentScore.toFixed(2)}</span>
                  <span>action {item.annotation.actionabilityScore.toFixed(2)}</span>
                  <span>requirement {item.annotation.productRequirement ? "yes" : "no"}</span>
                  <span>audience {item.annotation.audience.replaceAll("-", " ")}</span>
                  <span>type {item.annotation.requirementType.replaceAll("-", " ")}</span>
                  <span>stage {item.annotation.decisionStage.replaceAll("-", " ")}</span>
                  <span>opportunity {item.annotation.opportunityScore.toFixed(2)}</span>
                  <span>
                    gate {item.annotation.qualityGate.status} {item.annotation.qualityGate.score}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {totalItems === 0 ? (
        <p className="mt-10 text-sm text-zinc-500">
          Nothing for this date/filter. Check the weekly{" "}
          <a href="/digest" className="text-[var(--color-accent)] hover:underline">
            digest
          </a>{" "}
          instead.
        </p>
      ) : today.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {today.map((s) => (
            <SignalCard key={s.slug} s={s} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
