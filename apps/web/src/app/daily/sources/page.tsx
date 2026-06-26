import {
  buildDailyAutomationStatus,
  buildDailySourceQualityAudit,
  readSourceRefreshes,
  resolveAcceptedRefreshDate,
  type SourceQualityStatus,
} from '@/lib/daily-intelligence';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Source Audit - High Signal',
  description:
    'Daily source coverage, rejection reasons, and quality-gate status for High Signal reads.',
};

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

function statusClass(status: SourceQualityStatus) {
  if (status === 'accepted') return 'border-emerald-500/35 text-emerald-300';
  if (status === 'rejected') return 'border-red-500/45 text-red-300';
  return 'border-zinc-700 text-zinc-500';
}

function labelList(items: Array<{ k: string; n: number }>) {
  return items.map(({ k, n }) => `${k.replaceAll('-', ' ')} ${n}`).join(' / ') || 'none';
}

export default async function DailySourcesPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; status?: string; class?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const requestedDate = safeDate(params.date);
  const selectedStatus = ['accepted', 'rejected', 'missing'].includes(params.status ?? '')
    ? (params.status as SourceQualityStatus)
    : '';
  const selectedClass = params.class ?? '';
  const refreshes = await readSourceRefreshes();
  const sourceReadDate = resolveAcceptedRefreshDate(refreshes, requestedDate) ?? requestedDate;
  const sourceDateShifted = sourceReadDate !== requestedDate;
  const audit = buildDailySourceQualityAudit(refreshes, sourceReadDate);
  const automationStatus = buildDailyAutomationStatus(refreshes);
  const classes = audit.statusByClass.map((item) => item.k);
  const rows = audit.rows.filter(
    (row) =>
      (!selectedStatus || row.status === selectedStatus) &&
      (!selectedClass || row.sourceClass === selectedClass)
  );
  const query = new URLSearchParams({
    date: sourceReadDate,
    ...(selectedStatus ? { status: selectedStatus } : {}),
    ...(selectedClass ? { class: selectedClass } : {}),
  }).toString();

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <a
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
        href="/daily"
      >
        back to daily
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Source Audit</h1>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {sourceReadDate} / {audit.configuredSources} configured / {audit.acceptedSnapshots}{' '}
              accepted / {audit.rejectedSnapshots} rejected / {audit.missingSources} missing
            </p>
          </div>
          <a
            className="border border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href={`/daily/sources.json?${query}`}
          >
            JSON export
          </a>
        </div>
        {sourceDateShifted ? (
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            No accepted source-read snapshot exists for {requestedDate}; showing audit rows from{' '}
            {sourceReadDate}.
          </p>
        ) : null}
      </header>

      <form className="mt-6 grid gap-3 border-y border-zinc-800 py-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          date
          <input
            className="border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={requestedDate}
            name="date"
            type="date"
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          status
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedStatus}
            name="status"
          >
            <option value="">all</option>
            <option value="accepted">accepted</option>
            <option value="rejected">rejected</option>
            <option value="missing">missing</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          class
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedClass}
            name="class"
          >
            <option value="">all</option>
            {classes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button
          className="border border-zinc-800 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:self-end"
          type="submit"
        >
          load
        </button>
      </form>

      <section className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-6">
        {[
          ['observed', audit.observedSnapshots.toString()],
          ['accepted', audit.acceptedSnapshots.toString()],
          ['rejected', audit.rejectedSnapshots.toString()],
          ['missing', audit.missingSources.toString()],
          ['accepted items', audit.acceptedUnderlyingItems.toString()],
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
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              by class
            </div>
            <div className="mt-2 font-mono text-xs leading-6 text-zinc-400">
              {audit.statusByClass
                .map(
                  ({ k, accepted, rejected, missing }) => `${k} ${accepted}/${rejected}/${missing}`
                )
                .join(' / ')}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              reject reasons
            </div>
            <div className="mt-2 font-mono text-xs leading-6 text-zinc-400">
              {labelList(audit.rejectedReasons)}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              automation
            </div>
            <div className="mt-2 font-mono text-xs leading-6 text-zinc-400">
              {automationStatus.workflow} / {automationStatus.schedule} / latest{' '}
              {automationStatus.latestAcceptedDate ?? 'none'}
            </div>
          </div>
        </div>
        <div className="mt-5 divide-y divide-zinc-900 border-t border-zinc-900">
          {audit.actions.map((action) => (
            <div key={action.title} className="py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {action.priority} / action
              </div>
              <div className="mt-1 text-sm leading-6 text-zinc-200">{action.title}</div>
              <div className="mt-1 text-xs leading-5 text-zinc-500">{action.detail}</div>
              {action.affectedSources.length > 0 ? (
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                  {action.affectedSources.join(' / ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 divide-y divide-zinc-800 border-y border-zinc-800">
        {rows.map((row) => (
          <article key={`${row.sourceId}:${row.status}`} className="py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  <span>{row.sourceType}</span>
                  <span className="text-zinc-700">/</span>
                  <span>{row.sourceClass}</span>
                  <span className="text-zinc-700">/</span>
                  <span>{row.sourceId}</span>
                </div>
                <h2 className="mt-2 text-lg font-medium tracking-tight text-zinc-100">
                  {row.label}
                </h2>
              </div>
              <div
                className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${statusClass(row.status)}`}
              >
                {row.status}
              </div>
            </div>
            <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 md:grid-cols-5">
              <div>
                <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">snapshot</div>
                <div className="mt-1 font-mono">{row.snapshotDate?.slice(0, 10) ?? 'none'}</div>
              </div>
              <div>
                <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">items</div>
                <div className="mt-1 font-mono">{row.sourceCount}</div>
              </div>
              <div>
                <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">repeats</div>
                <div className="mt-1 font-mono">{row.repeatedSignalCount}</div>
              </div>
              <div>
                <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">
                  generic risk
                </div>
                <div className="mt-1 font-mono">{row.genericRisk}</div>
              </div>
              <div>
                <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">reasons</div>
                <div className="mt-1 font-mono">
                  {row.reasons.map((reason) => reason.replaceAll('-', ' ')).join(' / ') || 'none'}
                </div>
              </div>
            </div>
            {row.title ? <p className="mt-3 text-sm leading-6 text-zinc-400">{row.title}</p> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
