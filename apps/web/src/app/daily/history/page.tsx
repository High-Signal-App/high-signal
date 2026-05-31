import { dailyReadQuery, READ_DOMAINS, READ_SIGNAL_LAYERS, safeReadDomain, safeReadLayer } from "@/lib/daily-read-filters";
import { DAILY_REQUIREMENT_GATE } from "@/lib/daily-requirements";
import { buildDailyRangeSummary } from "@/lib/daily-range";
import {
  buildDailyAutomationStatus,
  DAILY_INTELLIGENCE_LAYER,
  dailyAnnotationRuntime,
  defaultDailyAnnotationOptions,
  readSourceRefreshes,
} from "@/lib/daily-intelligence";
import productGraph from "../../../../../../data/personal-product-graph.json";
import type { PersonalProductProfile, SignalContentCategory } from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Daily History - High Signal",
  description: "A dated archive of High Signal daily source reads, requirements, and task exports.",
};

const CATEGORY_LABELS: Array<{ value: SignalContentCategory; label: string }> = [
  { value: "ai-infra", label: "AI infra" },
  { value: "market-pulse", label: "market pulse" },
  { value: "product-opportunity", label: "product opportunities" },
  { value: "customer-complaint", label: "customer complaints" },
  { value: "startup-move", label: "startup moves" },
  { value: "regional-issue", label: "regional issues" },
  { value: "agent-evaluation", label: "agent evaluation" },
  { value: "policy-regulatory", label: "policy / regulatory" },
  { value: "security-risk", label: "security risk" },
  { value: "company-event", label: "company events" },
];

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeDays(value?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(31, Math.trunc(parsed)));
}

function safeCategory(value?: string): SignalContentCategory | "" {
  return CATEGORY_LABELS.some((item) => item.value === value) ? (value as SignalContentCategory) : "";
}

function labelCounts(counts: Array<{ k: string; n: number }>) {
  return counts.map(({ k, n }) => `${k.replaceAll("-", " ")} ${n}`).join(" / ") || "none";
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default async function DailyHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<{
    from?: string;
    to?: string;
    date?: string;
    days?: string;
    category?: string;
    readCategory?: string;
    layer?: string;
    domain?: string;
    requirement?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedCategory = safeCategory(params.category ?? params.readCategory);
  const selectedLayer = safeReadLayer(params.layer);
  const selectedDomain = safeReadDomain(params.domain);
  const selectedRequirement = params.requirement !== "no";
  const selectedDays = safeDays(params.days);
  const selectedTo = safeDate(params.to) ?? safeDate(params.date);
  const selectedFrom = safeDate(params.from);
  const refreshes = await readSourceRefreshes();
  const products = productGraph.products as PersonalProductProfile[];
  const annotationRuntime = await dailyAnnotationRuntime();
  const automationStatus = buildDailyAutomationStatus(refreshes);
  const summary = await buildDailyRangeSummary({
    records: refreshes,
    products,
    annotationOptions: defaultDailyAnnotationOptions(),
    filters: {
      category: selectedCategory,
      layer: selectedLayer,
      domain: selectedDomain,
      requirement: selectedRequirement,
    },
    from: selectedFrom,
    to: selectedTo,
    days: selectedDays,
    includeTasks: true,
  });
  const rangeQuery = dailyReadQuery({
    from: selectedFrom,
    to: selectedTo ?? summary.to,
    days: selectedDays,
    category: selectedCategory,
    layer: selectedLayer,
    domain: selectedDomain,
    requirement: selectedRequirement ? "yes" : "no",
    includeTasks: true,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
        href="/daily"
      >
        back to daily
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Daily History</h1>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {summary.from} to {summary.to} / {summary.daysReturned} day{summary.daysReturned === 1 ? "" : "s"} /{" "}
              {summary.totals.requirements} requirement{summary.totals.requirements === 1 ? "" : "s"}
            </p>
          </div>
          <a
            className="border border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href={`/daily/range.json?${rangeQuery}`}
          >
            JSON export
          </a>
        </div>
      </header>

      <form className="mt-6 grid gap-3 border-y border-zinc-800 py-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          from
          <input
            className="border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedFrom ?? ""}
            name="from"
            type="date"
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          to
          <input
            className="border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedTo ?? summary.to}
            name="to"
            type="date"
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          days
          <input
            className="border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedDays}
            max={31}
            min={1}
            name="days"
            type="number"
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          content
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedCategory}
            name="category"
          >
            <option value="">all</option>
            {CATEGORY_LABELS.map(({ value, label }) => (
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
                {label}
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
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          requirement
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedRequirement ? "yes" : "no"}
            name="requirement"
          >
            <option value="yes">yes</option>
            <option value="no">all</option>
          </select>
        </label>
        <button
          className="border border-zinc-800 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] lg:self-end"
          type="submit"
        >
          load
        </button>
      </form>

      <section className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-6">
        {[
          ["days", summary.daysReturned.toString()],
          ["reads", summary.totals.broadInsights.toString()],
          ["requirements", summary.totals.requirements.toString()],
          ["task exports", summary.totals.taskExports.toString()],
          ["sources", summary.totals.sourceCount.toString()],
          ["freshness", automationStatus.freshnessStatus],
        ].map(([label, value]) => (
          <div key={label} className="bg-black p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
            <div className="mt-3 break-words font-mono text-sm text-zinc-200">{value}</div>
          </div>
        ))}
      </section>

      <section className="mt-6 border-y border-zinc-800 py-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          intelligence layer
        </div>
        <div className="mt-2 font-mono text-[11px] leading-6 text-zinc-500">
          {DAILY_INTELLIGENCE_LAYER.broadReadAnnotation.method} / model none / no LLM /{" "}
          {annotationRuntime.activePath.replaceAll("-", " ")}
        </div>
        <div className="mt-2 font-mono text-[11px] leading-6 text-zinc-500">
          automation / {automationStatus.workflow} / {automationStatus.schedule} / latest accepted{" "}
          {automationStatus.latestAcceptedDate ?? "none"} / accepted {automationStatus.acceptedSnapshots} / rejected{" "}
          {automationStatus.rejectedSnapshots} / missing {automationStatus.missingSources}
        </div>
        <a
          className="mt-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:underline"
          href={`/daily/sources?date=${automationStatus.latestAcceptedDate ?? summary.to}`}
        >
          source audit
        </a>
        <a
          className="mt-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:underline"
          href="/daily/annotation.json"
        >
          annotation diagnostics
        </a>
        <div className="mt-2 font-mono text-[11px] leading-6 text-zinc-500">
          requirement gate / score {DAILY_REQUIREMENT_GATE.minScore}+ / sources{" "}
          {DAILY_REQUIREMENT_GATE.minSourceCount}+ / repeats{" "}
          {DAILY_REQUIREMENT_GATE.minRepeatedSignalCount}+ / build-change only
        </div>
        <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 md:grid-cols-3">
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">quality</div>
            <div className="mt-1 font-mono">
              {summary.totals.requirements} requirement / {summary.totals.broadInsights} read coverage /{" "}
              {percent(summary.totals.productRequirements, summary.totals.broadInsights)}
            </div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">repeats</div>
            <div className="mt-1 font-mono">{summary.totals.repeatedSignalCount} repeated source signals</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">range export</div>
            <a className="mt-1 block font-mono text-[var(--color-accent)] hover:underline" href={`/daily/range.json?${rangeQuery}`}>
              /daily/range.json
            </a>
          </div>
        </div>
      </section>

      <section className="mt-8 divide-y divide-zinc-800 border-y border-zinc-800">
        {summary.days.map((day) => {
          const dayQuery = dailyReadQuery({
            date: day.date,
            category: selectedCategory,
            layer: selectedLayer,
            domain: selectedDomain,
            requirement: selectedRequirement ? "yes" : "no",
          });
          const tasksQuery = dailyReadQuery({
            date: day.date,
            category: selectedCategory,
            layer: selectedLayer,
            domain: selectedDomain,
            requirement: true,
          });
          return (
            <article key={day.date} className="py-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {day.date} / reads {day.broadInsightCount} / sources {day.sourceCount}
                  </div>
                  <h2 className="mt-2 text-xl font-medium tracking-tight text-zinc-100">
                    {day.requirementCount} requirement{day.requirementCount === 1 ? "" : "s"} /{" "}
                    {day.taskExportCount} task export{day.taskExportCount === 1 ? "" : "s"}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
                  <a className="text-zinc-500 hover:text-[var(--color-accent)]" href={`/daily?${dayQuery}`}>
                    open daily
                  </a>
                  <a className="text-zinc-500 hover:text-[var(--color-accent)]" href={`/daily/tasks?${tasksQuery}`}>
                    tasks
                  </a>
                  <a className="text-zinc-500 hover:text-[var(--color-accent)]" href={`/daily/tasks.json?${tasksQuery}`}>
                    json
                  </a>
                  <a className="text-zinc-500 hover:text-[var(--color-accent)]" href={`/daily/sources?date=${day.date}`}>
                    source audit
                  </a>
                </div>
              </div>
              <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 md:grid-cols-4">
                <div>
                  <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">gate</div>
                  <div className="mt-1 font-mono">{labelCounts(day.qualityGateCounts)}</div>
                </div>
                <div>
                  <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">audience</div>
                  <div className="mt-1 font-mono">{labelCounts(day.audienceCounts)}</div>
                </div>
                <div>
                  <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">type</div>
                  <div className="mt-1 font-mono">{labelCounts(day.requirementTypeCounts)}</div>
                </div>
                <div>
                  <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">domain</div>
                  <div className="mt-1 font-mono">{labelCounts(day.domainCounts)}</div>
                </div>
              </div>
              {day.topRequirements.length > 0 ? (
                <div className="mt-5 divide-y divide-zinc-900 border-y border-zinc-900">
                  {day.topRequirements.slice(0, 3).map((item) => (
                    <a className="block py-4 hover:text-[var(--color-accent)]" href={item.href} key={item.id}>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        {item.priority} / score {item.score}
                        {item.fleetTarget
                          ? ` / ${item.fleetTarget.action} ${item.fleetTarget.productName} / fit ${item.fleetTarget.fitScore}`
                          : ""}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-zinc-100">{item.title}</div>
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      {summary.days.length === 0 ? (
        <p className="mt-10 text-sm text-zinc-500">No daily source-read snapshots matched this range.</p>
      ) : null}
    </main>
  );
}
