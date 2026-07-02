import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'History — High Signal',
  description: 'Historical signal performance and daily snapshots are being worked on.',
};

export default function HistoryPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-16 sm:px-6">
      <header className="border-b border-zinc-800 pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
          history
        </p>
        <h1 className="mt-4 text-3xl font-medium tracking-tight text-zinc-100">
          History is being worked on
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
          The live product is the signals feed. Historical scorecards, daily snapshots, and
          backtests will move here once the data is clean enough to make the page useful.
        </p>
      </header>
      <div className="mt-8 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
        {[
          ['Signal ledger', 'public hit-rate by signal type'],
          ['Daily archive', 'what changed each day'],
          ['Backtests', 'confidence calibration over time'],
        ].map(([title, body]) => (
          <div key={title} className="bg-[var(--color-bg)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              planned
            </div>
            <h2 className="mt-4 text-lg font-medium text-zinc-100">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
