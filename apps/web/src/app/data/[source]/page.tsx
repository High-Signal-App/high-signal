import type { Metadata, Route } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { api, type DataSourceEventsResponse } from '@/lib/api';
import catalog from '@/lib/source-catalog.json';

export const revalidate = 86400;

const PAGE = 50;
const DATA_CACHE_SECONDS = 86400;

const readDataSourceEvents = unstable_cache(
  (source: string, limit: number, offset: number, date: string | null) =>
    api.dataSourceEvents(source, {
      limit,
      offset,
      date: date ?? undefined,
    }),
  ['data-source-events'],
  { revalidate: DATA_CACHE_SECONDS }
);

interface CatalogEntry {
  id: string;
  provider: string;
  domains: string;
  access: string;
  official: boolean;
  windowDays: number;
  role: string;
  keeps: string;
  temporal: 'recent' | 'historical' | 'series';
}

function entryFor(source: string): CatalogEntry | undefined {
  return (catalog.sources as CatalogEntry[]).find((s) => s.id === source);
}

export function generateStaticParams() {
  return (catalog.sources as CatalogEntry[]).map((source) => ({ source: source.id }));
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function validIsoDay(day: string | undefined): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : day;
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function sourcePath(source: string, opts: { date?: string; all?: boolean; page?: number }): Route {
  const q = new URLSearchParams();
  if (opts.all) q.set('all', '1');
  else if (opts.date) q.set('date', opts.date);
  if (opts.page && opts.page > 0) q.set('p', String(opts.page));
  const qs = q.toString();
  return `/data/${encodeURIComponent(source)}${qs ? `?${qs}` : ''}` as Route;
}

export default async function DataSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string }>;
  searchParams: Promise<{ p?: string; date?: string; all?: string }>;
}) {
  const { source } = await params;
  const { p, date, all } = await searchParams;
  const page = Math.max(Number(p ?? 0) || 0, 0);
  const allHistory = all === '1';
  const selectedDate = allHistory ? undefined : (validIsoDay(date) ?? todayIso());
  const entry = entryFor(source);

  let data: DataSourceEventsResponse | null = null;
  try {
    data = await readDataSourceEvents(source, PAGE, page * PAGE, selectedDate ?? null);
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
            <span className="text-zinc-100">{total.toLocaleString()}</span>{' '}
            {selectedDate ? `events on ${selectedDate}` : 'events in store'}
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
        {entry && entry.temporal !== 'recent' && (
          <p className="mt-2 text-xs text-amber-400/70">
            {entry.temporal === 'series'
              ? 'Time-series source — historical context matters. Use pagination to browse older prints.'
              : 'Archive source — full history has value. Use pagination to browse older records.'}
          </p>
        )}
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2 font-mono text-[11px]">
        {selectedDate ? (
          <>
            <Link
              href={sourcePath(source, { date: addDays(selectedDate, -1) })}
              className="rounded border border-zinc-800 px-2 py-1 text-zinc-400 hover:border-zinc-600 hover:text-[var(--color-accent)]"
            >
              ← prev day
            </Link>
            <span className="rounded border border-zinc-700 px-2 py-1 text-zinc-100">
              {selectedDate}
            </span>
            <Link
              href={sourcePath(source, { date: addDays(selectedDate, 1) })}
              className="rounded border border-zinc-800 px-2 py-1 text-zinc-400 hover:border-zinc-600 hover:text-[var(--color-accent)]"
            >
              next day →
            </Link>
            <Link
              href={sourcePath(source, { all: true })}
              className="rounded border border-zinc-800 px-2 py-1 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            >
              all history
            </Link>
          </>
        ) : (
          <>
            <span className="rounded border border-zinc-700 px-2 py-1 text-zinc-100">
              all history
            </span>
            <Link
              href={sourcePath(source, { date: todayIso() })}
              className="rounded border border-zinc-800 px-2 py-1 text-zinc-400 hover:border-zinc-600 hover:text-[var(--color-accent)]"
            >
              today
            </Link>
          </>
        )}
      </div>

      {!data && (
        <p className="font-mono text-[11px] text-amber-400/80">
          Events store not reachable — try again once the API is up.
        </p>
      )}

      {data && events.length === 0 && (
        <p className="text-sm text-zinc-500">
          {selectedDate
            ? `No events stored for this source on ${selectedDate}. Try adjacent days or all history.`
            : 'No events stored for this source yet. Low-cadence or newly-added sources populate via the '}
          {!selectedDate && <code className="text-zinc-400">backfill-sources</code>}
          {!selectedDate && ' workflow.'}
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
              href={sourcePath(source, { date: selectedDate, all: allHistory, page: page - 1 })}
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
              href={sourcePath(source, { date: selectedDate, all: allHistory, page: page + 1 })}
              className="text-zinc-400 hover:text-[var(--color-accent)]"
            >
              older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {/* Quick-jump for historical / series sources with deep history */}
      {entry && entry.temporal !== 'recent' && total > 200 && (
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] text-zinc-600">
          <span className="text-zinc-500">jump:</span>
          {[
            0,
            Math.floor(total / PAGE / 4),
            Math.floor(total / PAGE / 2),
            Math.floor((total / PAGE) * 0.75),
          ]
            .filter((p, i, arr) => p > 0 && arr.indexOf(p) === i)
            .map((p) => (
              <Link
                key={p}
                href={sourcePath(source, { all: true, page: p })}
                className="rounded border border-zinc-800 px-1.5 py-0.5 hover:text-[var(--color-accent)]"
              >
                p{p + 1}
              </Link>
            ))}
        </div>
      )}
    </main>
  );
}
