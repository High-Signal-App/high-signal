import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell, SectionHeader } from '@/components/system/HighSignalUI';
import { api } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tickers — markets',
  description:
    'Ticker-first index of every tracked public company in High Signal: signals, price context, spillover map, and prediction-market consensus.',
  alternates: { canonical: `${SITE_URL}/markets/tickers` },
};

export default async function TickersIndexPage() {
  let entities: Awaited<ReturnType<typeof api.entities>>['entities'] = [];
  try {
    entities = (await api.entities()).entities;
  } catch {
    /* offline */
  }

  const withTicker = entities
    .filter((e) => e.ticker)
    .sort((a, b) => (a.ticker ?? '').localeCompare(b.ticker ?? ''));

  return (
    <PageShell>
      <Link
        href="/markets"
        className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
      >
        ← markets
      </Link>
      <SectionHeader eyebrow="ticker index" title="Tickers">
        Every tracked public company reachable by its ticker symbol. Each page shows signals, price
        context, the spillover graph, and prediction-market consensus.
      </SectionHeader>

      <section className="mt-10 border-y border-[var(--color-line)]">
        <div className="grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
          {withTicker.map((entity) => (
            <a
              key={entity.id}
              href={`/markets/${entity.ticker}`}
              className="group bg-[var(--color-bg)] p-4 transition-colors hover:bg-white/[0.02]"
            >
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-accent)]">
                {entity.ticker}
              </div>
              <div className="mt-2 text-base font-medium text-[var(--color-fg)] group-hover:text-white">
                {entity.name}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                {entity.sector ?? 'sector unknown'} · {entity.country ?? 'country unknown'}
              </div>
            </a>
          ))}
        </div>
      </section>

      {withTicker.length === 0 && (
        <p className="mt-8 text-sm text-[var(--color-muted)]">
          No entities with tickers are available right now. The entity graph may still be seeding.
        </p>
      )}
    </PageShell>
  );
}
