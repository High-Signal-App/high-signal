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

const PAGE_SIZE = 120;

function pageHref(page: number, query: string) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  const suffix = params.toString();
  return suffix ? `/markets/tickers?${suffix}` : '/markets/tickers';
}

export default async function TickersIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  let available = true;
  let entities: Awaited<ReturnType<typeof api.entities>>['entities'] = [];
  try {
    entities = (await api.entities()).entities;
  } catch {
    available = false;
  }

  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? '';
  const requestedPage = Number.parseInt(params.page ?? '1', 10);

  const withTicker = entities
    .filter((e) => e.ticker)
    .sort((a, b) => (a.ticker ?? '').localeCompare(b.ticker ?? ''));
  const filtered = query
    ? withTicker.filter(
        (entity) =>
          entity.ticker?.toLowerCase().includes(query) || entity.name.toLowerCase().includes(query)
      )
    : withTicker;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Number.isFinite(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

      <form className="mt-8 flex max-w-xl gap-2" action="/markets/tickers">
        <label className="sr-only" htmlFor="ticker-search">
          Search tickers or companies
        </label>
        <input
          id="ticker-search"
          name="q"
          type="search"
          defaultValue={params.q}
          placeholder="Search ticker or company"
          className="min-h-11 min-w-0 flex-1 border border-[var(--color-line)] bg-transparent px-3 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          className="min-h-11 border border-[var(--color-line)] px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          search
        </button>
      </form>

      {!available && (
        <p
          className="mt-8 border border-[var(--color-line)] p-5 text-sm text-[var(--color-muted)]"
          role="status"
        >
          The ticker directory is temporarily unavailable. This is not an empty result set; retry
          this page later.
        </p>
      )}

      <section className="mt-10 border-y border-[var(--color-line)]">
        <div className="grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((entity) => (
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

      {available && pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Ticker pages">
          {page > 1 ? (
            <a
              className="min-h-11 py-3 text-sm text-[var(--color-accent)]"
              href={pageHref(page - 1, query)}
            >
              ← previous
            </a>
          ) : (
            <span />
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <a
              className="min-h-11 py-3 text-sm text-[var(--color-accent)]"
              href={pageHref(page + 1, query)}
            >
              next →
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}

      {available && filtered.length === 0 && (
        <p className="mt-8 text-sm text-[var(--color-muted)]">
          {query
            ? `No ticker or company matches “${params.q}”. Try a shorter symbol or name.`
            : 'No entities with tickers are available yet.'}
        </p>
      )}
    </PageShell>
  );
}
