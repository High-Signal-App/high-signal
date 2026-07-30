import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'History',
  description:
    'Browse High Signal track records, daily source reads, market snapshots, and archived briefs.',
};

const HISTORY_DESTINATIONS = [
  {
    href: '/track-record',
    eyebrow: 'signal performance',
    title: 'Track record',
    body: 'Forward predictions and historical calibration, scored by signal type.',
  },
  {
    href: '/daily/history',
    eyebrow: 'source intelligence',
    title: 'Daily history',
    body: 'Dated source reads, requirement coverage, filters, and JSON exports.',
  },
  {
    href: '/markets/history',
    eyebrow: 'market data',
    title: 'Market history',
    body: 'Date-browsable snapshots for the national and international watchlist.',
  },
  {
    href: '/brief/archive',
    eyebrow: 'published record',
    title: 'Brief archive',
    body: 'Permanent daily briefs preserved as they were originally published.',
  },
] as const;

export default function HistoryPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-16 sm:px-6">
      <header className="border-b border-zinc-800 pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
          history
        </p>
        <h1 className="mt-4 text-3xl font-medium tracking-tight text-zinc-100">
          Historical records
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
          Review signal performance, source intelligence, market snapshots, and the permanent daily
          brief archive.
        </p>
      </header>
      <div className="mt-8 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-2">
        {HISTORY_DESTINATIONS.map(({ href, eyebrow, title, body }) => (
          <Link
            key={href}
            href={href}
            className="group bg-[var(--color-bg)] p-5 transition-colors hover:bg-zinc-900"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {eyebrow}
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium text-zinc-100 group-hover:text-[var(--color-accent)]">
                {title}
              </h2>
              <span
                aria-hidden="true"
                className="font-mono text-sm text-zinc-600 group-hover:text-[var(--color-accent)]"
              >
                →
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
