import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageShell } from '@/components/system/HighSignalUI';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Brief archive — every daily brief, permanently',
  description:
    'Every High Signal Daily Brief is permanently archived at /brief/<date>. Browse the full history of composed briefs by date.',
  alternates: { canonical: `${SITE_URL}/brief/archive` },
};

interface ArchiveEntry {
  date: string;
  regionCount: number;
  computedAt: string;
}

function formatDate(iso: string) {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export default async function BriefArchivePage() {
  let entries: ArchiveEntry[] = [];
  let available = false;
  try {
    const res = await api.briefDates();
    entries = res.dates;
    available = entries.length > 0;
  } catch {
    /* api offline */
  }

  return (
    <PageShell>
      <header className="border-b border-[var(--color-line)] pb-6">
        <Link
          href="/brief"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
        >
          ← today’s brief
        </Link>
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          permanent archive
        </div>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Brief archive</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
          Every Daily Brief is permanently archived at{' '}
          <code className="text-zinc-300">/brief/&lt;YYYY-MM-DD&gt;</code>. The snapshot is the
          record — briefs are never rebuilt from live data after the fact, so a link to a past brief
          always returns the same content. Snapshots are precomputed daily by the brief cron and
          stored in the <code className="text-zinc-300">daily_brief_snapshots</code> table.
        </p>
        {available && (
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {entries.length} archived date{entries.length === 1 ? '' : 's'}
          </p>
        )}
      </header>

      {!available ? (
        <section className="mt-12 border border-dashed border-zinc-800 p-10 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no archived briefs yet
          </p>
          <p className="mt-3 text-sm text-zinc-500">
            Brief snapshots are stored daily by the precompute cron. The archive
            will populate as the cron runs. Today’s brief is always available at{' '}
            <Link href="/brief" className="text-[var(--color-accent)] hover:underline">
              /brief
            </Link>
            .
          </p>
        </section>
      ) : (
        <section className="mt-8">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            by date
          </h2>
          <ul className="mt-4 divide-y divide-zinc-800 border-y border-zinc-800">
            {entries.map((entry) => (
              <li key={entry.date} className="py-4">
                <Link
                  href={`/brief/${entry.date}`}
                  className="group flex flex-wrap items-baseline gap-x-4 gap-y-1"
                >
                  <span className="font-mono text-sm text-zinc-100 group-hover:text-[var(--color-accent)]">
                    {entry.date}
                  </span>
                  <span className="text-sm text-zinc-400">{formatDate(entry.date)}</span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {entry.regionCount} region{entry.regionCount === 1 ? '' : 's'}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] opacity-0 group-hover:opacity-100">
                    read →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
        <p>
          Briefs are permanent. The{' '}
          <code className="text-zinc-400">daily_brief_snapshots</code> table is append-only by date
          + region; the cron upserts the same day’s snapshot but never deletes prior dates.
        </p>
      </footer>
    </PageShell>
  );
}
