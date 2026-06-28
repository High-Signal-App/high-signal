import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type DataSourceEventsResponse } from '@/lib/api';
import catalog from '@/lib/source-catalog.json';

export const dynamic = 'force-dynamic';

const PAGE = 50;

interface CatalogEntry {
  id: string;
  provider: string;
  domains: string;
  access: string;
  official: boolean;
  windowDays: number;
  role: string;
  keeps: string;
}

function entryFor(source: string): CatalogEntry | undefined {
  return (catalog.sources as CatalogEntry[]).find((s) => s.id === source);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ source: string }>;
}): Promise<Metadata> {
  const { source } = await params;
  const e = entryFor(source);
  return {
    title: `${source} — data | High Signal`,
    description: e
      ? `Ingested events from ${e.provider} (${source}).`
      : `Ingested events from ${source}.`,
  };
}

function fmtDate(unixSec: number): string {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export default async function DataSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { source } = await params;
  const { p } = await searchParams;
  const page = Math.max(Number(p ?? 0) || 0, 0);
  const entry = entryFor(source);

  let data: DataSourceEventsResponse | null = null;
  try {
    data = await api.dataSourceEvents(source, { limit: PAGE, offset: page * PAGE });
  } catch {
    /* worker/D1 unreachable */
  }

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/data"
        className="font-mono text-[11px] text-zinc-500 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
      >
        ← data directory
      </Link>

      <header className="mt-4 mb-8 border-b border-zinc-800 pb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-100">
            {source}
          </h1>
          {entry && <span className="text-sm text-zinc-500">{entry.provider}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs tabular-nums text-zinc-400">
          <span>
            <span className="text-zinc-100">{total.toLocaleString()}</span> events in store
          </span>
          {entry && (
            <>
              <span>role: {entry.role}</span>
              <span>{entry.windowDays}d history</span>
              <span>access: {entry.access}</span>
            </>
          )}
        </div>
        {entry && (
          <p className="mt-2 text-xs text-zinc-500">
            Keeps: <span className="text-zinc-400">{entry.keeps}</span>
          </p>
        )}
      </header>

      {!data && (
        <p className="font-mono text-[11px] text-amber-400/80">
          Events store not reachable — try again once the API is up.
        </p>
      )}

      {data && events.length === 0 && (
        <p className="text-sm text-zinc-500">
          No events stored for this source yet. Low-cadence or newly-added sources populate via the{' '}
          <code className="text-zinc-400">backfill-sources</code> workflow.
        </p>
      )}

      <ul className="divide-y divide-zinc-900">
        {events.map((ev) => (
          <li key={`${ev.url}-${ev.publishedAt}`} className="py-3">
            <div className="flex items-baseline gap-3">
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-600">
                {fmtDate(ev.publishedAt)}
              </span>
              <a
                href={ev.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-zinc-200 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
              >
                {ev.title ?? ev.url}
              </a>
            </div>
            {ev.content && (
              <p className="mt-1 line-clamp-2 pl-[4.5rem] text-xs leading-relaxed text-zinc-500">
                {ev.content.slice(0, 280)}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2 pl-[4.5rem] font-mono text-[10px] text-zinc-600">
              {ev.entity && (
                <Link
                  href={`/entities/${encodeURIComponent(ev.entity)}`}
                  className="rounded border border-zinc-800 px-1.5 py-0.5 hover:text-[var(--color-accent)]"
                >
                  {ev.entity}
                </Link>
              )}
              {ev.source !== source && (
                <span className="rounded border border-zinc-800 px-1.5 py-0.5">{ev.source}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {(page > 0 || hasMore) && (
        <nav className="mt-8 flex items-center justify-between font-mono text-xs">
          {page > 0 ? (
            <Link
              href={`/data/${encodeURIComponent(source)}?p=${page - 1}`}
              className="text-zinc-400 hover:text-[var(--color-accent)]"
            >
              ← newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-600">
            {total > 0
              ? `${page * PAGE + 1}–${page * PAGE + events.length} of ${total.toLocaleString()}`
              : ''}
          </span>
          {hasMore ? (
            <Link
              href={`/data/${encodeURIComponent(source)}?p=${page + 1}`}
              className="text-zinc-400 hover:text-[var(--color-accent)]"
            >
              older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
