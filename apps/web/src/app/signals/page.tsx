import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { HistoryGate } from '@/components/history/HistoryGate';
import { SignalCard } from '@/components/molecules/SignalCard';
import { PageShell } from '@/components/system/HighSignalUI';
import { api, type SignalRow } from '@/lib/api';
import { verifiedHistoryGrant } from '@/lib/history-access';
import { isBackfillSignal } from '@/lib/signal-format';
import { istDay, isProtectedHistoryDay } from '@high-signal/shared';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Signals',
  description:
    'The chronological High Signal record. Open any signal to inspect its reasoning, evidence, corroboration, and uncertainty.',
  alternates: { canonical: '/signals' },
};

const HISTORY_PAGE_SIZE = 20;

function formatDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

async function signalsForDay(day: string): Promise<SignalRow[]> {
  try {
    const result = await api.signals({ date: day, limit: 200 });
    return result.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    return [];
  }
}

function SignalDay({ day, label, signals }: { day: string; label: string; signals: SignalRow[] }) {
  return (
    <section className="mt-10" aria-labelledby={`signals-${label.toLowerCase()}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-3">
        <div>
          <h2
            id={`signals-${label.toLowerCase()}`}
            className="text-xl font-medium tracking-tight text-[var(--color-fg)]"
          >
            {label}
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
            {day} · {signals.length} published signal{signals.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href={(label === 'Today' ? '/' : '/?day=yesterday') as Route}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          read brief →
        </Link>
      </div>
      {signals.length > 0 ? (
        <div className="divide-y divide-[var(--color-line)]">
          {signals.map((signal) => (
            <SignalCard key={signal.id} s={signal} />
          ))}
        </div>
      ) : (
        <p className="border-b border-[var(--color-line)] py-8 text-sm leading-6 text-[var(--color-muted)]">
          No signal cleared the evidence and materiality gates for this day.
        </p>
      )}
    </section>
  );
}

export default async function SignalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ p?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const page = Math.max(0, Number(params.p ?? 0) || 0);
  const today = istDay();
  const yesterday = istDay(new Date(), -1);
  const [todaySignals, yesterdaySignals, historyGrant] = await Promise.all([
    signalsForDay(today),
    signalsForDay(yesterday),
    verifiedHistoryGrant(),
  ]);

  let historyDates: Awaited<ReturnType<typeof api.briefDates>>['dates'] = [];
  if (historyGrant) {
    try {
      const result = await api.briefDates(historyGrant);
      historyDates = result.dates.filter((entry) => isProtectedHistoryDay(entry.date));
    } catch {
      /* The protected state remains explicit below. */
    }
  }
  const start = page * HISTORY_PAGE_SIZE;
  const visibleHistory = historyDates.slice(start, start + HISTORY_PAGE_SIZE);
  const hasPrevious = page > 0;
  const hasNext = start + HISTORY_PAGE_SIZE < historyDates.length;

  return (
    <PageShell max="max-w-5xl">
      <header className="border-b border-[var(--color-line)] pb-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          chronological record
        </p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Signals</h1>
        <p className="mt-4 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
          Today and yesterday are open. Each signal leads to the claim, its direct impact,
          uncertainty, and the exact primary and corroborating sources used to publish it.
        </p>
      </header>

      <SignalDay day={today} label="Today" signals={todaySignals} />
      <SignalDay day={yesterday} label="Yesterday" signals={yesterdaySignals} />

      <section className="mt-12 border-t border-[var(--color-line)] pt-8" aria-labelledby="earlier">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          earlier
        </div>
        <h2 id="earlier" className="mt-3 text-2xl font-medium tracking-tight">
          Earlier signals by brief date
        </h2>
        {!historyGrant ? (
          <HistoryGate />
        ) : visibleHistory.length > 0 ? (
          <>
            <ul className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {visibleHistory.map((entry) => (
                <li key={entry.date}>
                  <Link
                    href={`/brief/${entry.date}` as Route}
                    className="group flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
                  >
                    <span className="font-mono text-sm text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
                      {entry.date}
                    </span>
                    <span className="text-sm text-[var(--color-muted)]">
                      {formatDay(entry.date)}
                    </span>
                    <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
                      {entry.publicItemCount} item{entry.publicItemCount === 1 ? '' : 's'}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
                      read →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <nav
              aria-label="Earlier signal pages"
              className="mt-5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              {hasPrevious ? (
                <Link
                  href={`/signals?p=${page - 1}` as Route}
                  className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                >
                  ← newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-[var(--color-muted)]">page {page + 1}</span>
              {hasNext ? (
                <Link
                  href={`/signals?p=${page + 1}` as Route}
                  className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                >
                  older →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        ) : (
          <p className="mt-6 border-y border-[var(--color-line)] py-8 text-sm text-[var(--color-muted)]">
            No earlier Daily Brief snapshots are available.
          </p>
        )}
      </section>
    </PageShell>
  );
}
