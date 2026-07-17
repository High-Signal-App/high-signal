import {
  dailyReadMatches,
  dailyReadQuery,
  READ_DOMAINS,
  READ_SIGNAL_LAYERS,
  safeReadDomain,
  safeReadLayer,
} from '@/lib/daily-read-filters';
import { DAILY_REQUIREMENT_GATE, buildDailyRequirementQueue } from '@/lib/daily-requirements';
import { buildDailyRequirementTaskExports } from '@/lib/daily-task-export';
import {
  buildDailyAutomationStatus,
  buildDailyBroadInsightsWithAnnotations,
  dailyAnnotationRuntime,
  defaultDailyAnnotationOptions,
  resolveAcceptedRefreshDate,
  readSourceRefreshes,
} from '@/lib/daily-intelligence';
import productGraph from '../../../../../../data/personal-product-graph.json';
import type { PersonalProductProfile, SignalContentCategory } from '@high-signal/shared';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Daily Tasks',
  description: 'Actionable build/change tasks generated from High Signal daily requirement reads.',
};

const CATEGORY_LABELS: Array<{ value: SignalContentCategory; label: string }> = [
  { value: 'ai-infra', label: 'AI infra' },
  { value: 'market-pulse', label: 'market pulse' },
  { value: 'product-opportunity', label: 'product opportunities' },
  { value: 'customer-complaint', label: 'customer complaints' },
  { value: 'startup-move', label: 'startup moves' },
  { value: 'regional-issue', label: 'regional issues' },
  { value: 'agent-evaluation', label: 'agent evaluation' },
  { value: 'policy-regulatory', label: 'policy / regulatory' },
  { value: 'security-risk', label: 'security risk' },
  { value: 'company-event', label: 'company events' },
];

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

function safeCategory(value?: string): SignalContentCategory | '' {
  return CATEGORY_LABELS.some((item) => item.value === value)
    ? (value as SignalContentCategory)
    : '';
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function priorityTone(priority: string) {
  if (priority === 'critical' || priority === 'high') return 'text-red-300';
  if (priority === 'medium') return 'text-zinc-200';
  return 'text-zinc-500';
}

export default async function DailyTasksPage({
  searchParams,
}: {
  searchParams?: Promise<{
    date?: string;
    category?: string;
    layer?: string;
    domain?: string;
    requirement?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedDate = safeDate(params.date);
  const selectedCategory = safeCategory(params.category);
  const selectedLayer = safeReadLayer(params.layer);
  const selectedDomain = safeReadDomain(params.domain);
  const selectedRequirement = params.requirement !== 'no';
  const refreshes = await readSourceRefreshes();
  const sourceReadDate = resolveAcceptedRefreshDate(refreshes, selectedDate) ?? selectedDate;
  const sourceDateShifted = sourceReadDate !== selectedDate;
  const allBroadInsights = await buildDailyBroadInsightsWithAnnotations(
    refreshes,
    sourceReadDate,
    defaultDailyAnnotationOptions()
  );
  const broadInsights = allBroadInsights.filter((item) =>
    dailyReadMatches(item, {
      category: selectedCategory,
      layer: selectedLayer,
      domain: selectedDomain,
      requirement: selectedRequirement,
    })
  );
  const products = productGraph.products as PersonalProductProfile[];
  const requirementQueue = buildDailyRequirementQueue(broadInsights, 50, products);
  const taskExports = buildDailyRequirementTaskExports(requirementQueue);
  const automationStatus = buildDailyAutomationStatus(refreshes);
  const annotationRuntime = await dailyAnnotationRuntime();
  const productCounts = countBy(taskExports.map((item) => item.projectSlug));
  const actionCounts = countBy(taskExports.map((item) => item.action));
  const priorityCounts = countBy(taskExports.map((item) => item.priority));
  const layerCounts = countBy(allBroadInsights.map((item) => item.annotation.signalLayer));
  const domainCounts = countBy(allBroadInsights.flatMap((item) => item.annotation.domains));
  const pageQuery = dailyReadQuery({
    date: sourceReadDate,
    category: selectedCategory,
    layer: selectedLayer,
    domain: selectedDomain,
    requirement: selectedRequirement ? 'yes' : 'no',
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
            <h1 className="text-3xl font-medium tracking-tight">Daily Tasks</h1>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {sourceReadDate} / {taskExports.length} task export
              {taskExports.length === 1 ? '' : 's'} / {requirementQueue.length} accepted requirement
              {requirementQueue.length === 1 ? '' : 's'}
            </p>
          </div>
          <a
            className="border border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href={`/daily/tasks.json?${pageQuery}`}
          >
            JSON export
          </a>
        </div>
        {sourceDateShifted ? (
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            No accepted source-read snapshot exists for {selectedDate}; showing task exports from{' '}
            {sourceReadDate}.
          </p>
        ) : null}
      </header>

      <form className="mt-6 grid gap-3 border-y border-zinc-800 py-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
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
        <button
          className="border border-zinc-800 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] lg:self-end"
          type="submit"
        >
          load
        </button>
      </form>

      <section className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-6">
        {[
          ['tasks', taskExports.length.toString()],
          ['requirements', requirementQueue.length.toString()],
          ['reads', broadInsights.length.toString()],
          ['products', productCounts.map(([k, n]) => `${k} ${n}`).join(' / ') || 'none'],
          ['actions', actionCounts.map(([k, n]) => `${k} ${n}`).join(' / ') || 'none'],
          ['freshness', automationStatus.freshnessStatus],
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
        <div className="grid gap-5 text-xs leading-6 text-zinc-500 md:grid-cols-3">
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">gate</div>
            <div className="mt-1 font-mono">
              score {DAILY_REQUIREMENT_GATE.minScore}+ / sources{' '}
              {DAILY_REQUIREMENT_GATE.minSourceCount}+ / repeats{' '}
              {DAILY_REQUIREMENT_GATE.minRepeatedSignalCount}+ / build-change only
            </div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">priority</div>
            <div className="mt-1 font-mono">
              {priorityCounts.map(([k, n]) => `${k} ${n}`).join(' / ') || 'none'}
            </div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">annotation</div>
            <div className="mt-1 font-mono">
              {annotationRuntime.activePath.replaceAll('-', ' ')} / model none / no LLM
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 divide-y divide-zinc-800 border-y border-zinc-800">
        {requirementQueue.length > 0 ? (
          requirementQueue.map((item) => {
            const task = taskExports.find((exported) => exported.requirementId === item.id);
            return (
              <article key={item.id} className="py-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      <span className={priorityTone(item.priority)}>{item.priority}</span>
                      <span className="text-zinc-700">/</span>
                      <span>score {item.score}</span>
                      <span className="text-zinc-700">/</span>
                      <span>{item.fleetTarget?.action ?? 'watch'}</span>
                      <span className="text-zinc-700">/</span>
                      <span>{item.fleetTarget?.productName ?? 'no target'}</span>
                    </div>
                    <h2 className="mt-2 text-xl font-medium tracking-tight text-zinc-100">
                      {item.title}
                    </h2>
                  </div>
                  {task ? (
                    <a
                      className="border border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                      href={item.href}
                    >
                      evidence
                    </a>
                  ) : null}
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">{item.summary}</p>
                <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 md:grid-cols-3">
                  <div>
                    <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">
                      suggested build
                    </div>
                    <div className="mt-1">{item.suggestedBuild}</div>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">
                      why now
                    </div>
                    <div className="mt-1">{item.whyNow}</div>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">
                      next step
                    </div>
                    <div className="mt-1">{item.nextStep}</div>
                  </div>
                </div>
                {item.fleetTarget ? (
                  <div className="mt-4 border border-zinc-900 p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                      target / {item.fleetTarget.productSlug} / fit {item.fleetTarget.fitScore}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-zinc-500">
                      {item.fleetTarget.reason}. {item.fleetTarget.defaultAction}
                    </div>
                    {item.alternativeFleetTargets.length > 0 ? (
                      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                        alternates{' '}
                        {item.alternativeFleetTargets
                          .map(
                            (target) => `${target.productName} ${target.action} ${target.fitScore}`
                          )
                          .join(' / ')}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 md:grid-cols-2">
                  <div>
                    <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">
                      acceptance
                    </div>
                    <ul className="mt-1 space-y-1">
                      {item.acceptanceCriteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">
                      export
                    </div>
                    <div className="mt-1 font-mono">
                      {task
                        ? `${task.projectSlug} / ${task.action} / ${task.priority} / ${task.status}`
                        : 'no task export'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                      {item.scoreBreakdown.map((part) => (
                        <span key={part.label}>
                          {part.label.replaceAll('-', ' ')} {part.contribution}/{part.max}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="py-10 text-sm leading-6 text-zinc-500">
            No task exports match this filter. Loosen the content, layer, or domain filter.
          </div>
        )}
      </section>
    </main>
  );
}
