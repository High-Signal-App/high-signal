import {
  BackLink,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
} from '@/components/system/HighSignalUI';
import { api, type BacktestWorkbench, type BacktestWorkbenchBucket } from '@/lib/api';
import { requireSignedIn } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Backtest Workbench — High Signal' };

const emptyWorkbench: BacktestWorkbench = {
  cohort: 'live',
  summary: {
    signals: 0,
    matured: 0,
    pending: 0,
    avgActionScore: null,
    evidenceReadyRate: 0,
    promoteTypes: 0,
    rewriteTypes: 0,
  },
  buckets: [],
  examples: [],
};

function pct(value: number | null) {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function score(value: number | null) {
  return value == null ? '—' : value.toString();
}

function actionTone(action: BacktestWorkbenchBucket['recommendedAction']) {
  if (action === 'promote') return 'text-[var(--color-up)]';
  if (action === 'retire-or-rewrite') return 'text-[var(--color-down)]';
  if (action === 'tighten-thesis') return 'text-amber-300';
  return 'text-[var(--color-accent)]';
}

function bandTone(band: string) {
  if (band === 'compound') return 'text-[var(--color-up)]';
  if (band === 'retire') return 'text-[var(--color-down)]';
  if (band === 'watch') return 'text-amber-300';
  return 'text-[var(--color-muted)]';
}

export default async function BacktestWorkbenchPage() {
  await requireSignedIn();

  let workbench = emptyWorkbench;
  try {
    workbench = await api.backtestWorkbench('live');
  } catch {
    /* Offline fallback keeps the route renderable before D1 is seeded. */
  }

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="signal audit / action quality" title="Backtest Workbench">
        Compare signal types by whether they produced useful operator actions, not just whether the
        forward return landed. The score rewards hits, calibrated confidence, enough evidence, clear
        direction, and short enough windows to act on.
      </SectionHeader>

      <MetricGrid
        items={[
          { label: 'cohort', value: workbench.cohort },
          { label: 'matured', value: workbench.summary.matured.toString() },
          { label: 'avg action score', value: score(workbench.summary.avgActionScore) },
          { label: 'evidence-ready', value: pct(workbench.summary.evidenceReadyRate) },
        ]}
      />

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <Panel eyebrow="promotion candidates" title={workbench.summary.promoteTypes.toString()}>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Signal types with enough matured samples, strong hit-rate, and action scores high enough
            to deserve more prominent placement in digests and watchlists.
          </p>
        </Panel>
        <Panel eyebrow="rewrite candidates" title={workbench.summary.rewriteTypes.toString()}>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Signal types whose historical actions missed, lacked enough evidence, or were too vague
            to justify continued operator attention without a thesis rewrite.
          </p>
        </Panel>
      </section>

      <section className="mt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          signal type decision table
        </div>
        {workbench.buckets.length === 0 ? (
          <div className="mt-4 border border-dashed border-[var(--color-line)] p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            no scored live signals yet
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto border border-[var(--color-line)]">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                <tr>
                  <th className="border-b border-[var(--color-line)] px-3 py-3 text-left">type</th>
                  <th className="border-b border-[var(--color-line)] px-3 py-3 text-right">n</th>
                  <th className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                    hit-rate
                  </th>
                  <th className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                    action score
                  </th>
                  <th className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                    evidence
                  </th>
                  <th className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                    decision
                  </th>
                </tr>
              </thead>
              <tbody className="nums">
                {workbench.buckets.map((bucket) => (
                  <tr key={bucket.signalType}>
                    <td className="border-b border-[var(--color-line)] px-3 py-3 font-mono text-xs">
                      {bucket.signalType}
                    </td>
                    <td className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                      {bucket.matured}/{bucket.count}
                    </td>
                    <td className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                      {pct(bucket.hitRate)}
                    </td>
                    <td className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                      {score(bucket.avgActionScore)}
                    </td>
                    <td className="border-b border-[var(--color-line)] px-3 py-3 text-right">
                      {pct(bucket.evidenceReadyRate)}
                    </td>
                    <td
                      className={`border-b border-[var(--color-line)] px-3 py-3 text-right font-mono text-[10px] uppercase tracking-[0.16em] ${actionTone(bucket.recommendedAction)}`}
                    >
                      {bucket.recommendedAction}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 grid gap-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          scored signal examples
        </div>
        {workbench.examples.map((example) => (
          <a
            key={example.id}
            href={`/signals/${example.slug}`}
            className="block border border-[var(--color-line)] p-5 hover:border-[var(--color-accent)]"
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {example.signalType} / {example.confidence} / {example.outcome}
                </div>
                <h2 className="mt-2 text-lg">{example.title ?? example.slug}</h2>
              </div>
              <div className="text-left md:text-right">
                <div className="nums text-2xl">{score(example.actionScore)}</div>
                <div
                  className={`font-mono text-[10px] uppercase tracking-[0.18em] ${bandTone(example.actionBand)}`}
                >
                  {example.actionBand}
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
              {example.evidenceCount} evidence links · {example.windowDays}d window · return{' '}
              {example.forwardReturn == null
                ? 'pending'
                : `${(example.forwardReturn * 100).toFixed(1)}%`}
            </p>
          </a>
        ))}
      </section>
    </PageShell>
  );
}
