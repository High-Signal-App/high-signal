import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type DataSourceLive } from '@/lib/api';
import catalog from '@/lib/source-catalog.json';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Data — every source High Signal ingests',
  description:
    'Explore the data sources behind High Signal: every ingestion source, how each is stored, how much history is pulled, and what data is available right now.',
};

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

const ROLE_ORDER = ['entity', 'corroboration', 'thematic', 'numeric'] as const;
const ROLE_BLURB: Record<string, string> = {
  entity: 'Maps to a tracked company — can become a standalone signal.',
  corroboration: 'Official source, mostly entity-less — strengthens other signals.',
  thematic: 'Topic / keyword (entity-less) — feeds a domain thematically.',
  numeric: 'Time-series values — macro / energy context.',
};

const TEMPORAL_META = {
  recent: { label: 'live', title: 'Only the latest events matter — stale after days', icon: '●' },
  historical: {
    label: 'archive',
    title: 'Full history has value — patents, filings, court cases',
    icon: '▤',
  },
  series: {
    label: 'series',
    title: 'Time-series: both recent prints and historical trends matter',
    icon: '∿',
  },
} as const;

function accessTone(access: string): string {
  if (access === 'keyless') return 'border-[var(--color-accent)]/40 text-[var(--color-accent)]';
  if (access.startsWith('free-key')) return 'border-amber-500/40 text-amber-400';
  return 'border-zinc-700 text-zinc-400';
}

function accessLabel(access: string): string {
  if (access === 'keyless') return 'keyless';
  if (access.startsWith('free-key')) return 'free key';
  if (access.startsWith('optional-key')) return 'optional key';
  return access;
}

function relativeDays(unixSec: number, nowSec: number): string {
  if (!unixSec) return '—';
  const d = Math.floor((nowSec - unixSec) / 86400);
  if (d <= 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function uniqueSamples(samples: DataSourceLive['samples'] = []) {
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const key = sample.url || sample.title || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function DataPage() {
  const sources = catalog.sources as CatalogEntry[];
  const nowSec = Math.floor(Date.now() / 1000);

  let live: Record<string, DataSourceLive> = {};
  let available = false;
  let liveTotal = 0;
  try {
    const res = await api.dataSources();
    available = res.available;
    liveTotal = res.total;
    live = Object.fromEntries(res.sources.map((s) => [s.id, s]));
  } catch {
    /* worker/D1 unavailable — render the catalog without live counts */
  }

  const liveCount = sources.filter((s) => (live[s.id]?.count ?? 0) > 0).length;
  const temporalCounts = {
    recent: sources.filter((s) => s.temporal === 'recent').length,
    historical: sources.filter((s) => s.temporal === 'historical').length,
    series: sources.filter((s) => s.temporal === 'series').length,
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          Data directory
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
          {sources.length} data sources
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Every public source High Signal curates into the daily brief. We{' '}
          <span className="text-zinc-200">extract the info and keep the link</span> — never the raw
          payload that&apos;s one query away. Duplicate stories across sources are collapsed,
          keeping the distinct-source count as corroboration.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs tabular-nums text-zinc-400">
          <span>
            <span className="text-zinc-100">{sources.length}</span> sources
          </span>
          <span>
            <span className="text-[var(--color-accent)]">{liveCount}</span> with data now
          </span>
          {available && (
            <span>
              <span className="text-zinc-100">{liveTotal.toLocaleString()}</span> events in store
            </span>
          )}
          <span title={TEMPORAL_META.recent.title}>
            <span className="text-zinc-100">{temporalCounts.recent}</span> live
          </span>
          <span title={TEMPORAL_META.historical.title}>
            <span className="text-zinc-100">{temporalCounts.historical}</span> archive
          </span>
          <span title={TEMPORAL_META.series.title}>
            <span className="text-zinc-100">{temporalCounts.series}</span> series
          </span>
        </div>
        {!available && (
          <p className="mt-3 font-mono text-[11px] text-amber-400/80">
            Live counts unavailable (events store not reachable) — showing the catalog. Regenerate
            samples locally with <code>python -m high_signal_ingest.data_directory</code>.
          </p>
        )}
      </header>

      {ROLE_ORDER.map((role) => {
        const rows = sources.filter((s) => s.role === role);
        if (rows.length === 0) return null;
        return (
          <section key={role} className="mb-10">
            <div className="mb-3 flex items-baseline gap-3 border-b border-zinc-800 pb-2">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">
                {role}
              </h2>
              <span className="text-xs text-zinc-500">{ROLE_BLURB[role]}</span>
            </div>
            <div className="divide-y divide-zinc-900">
              {rows.map((s) => {
                const l = live[s.id];
                const count = l?.count ?? 0;
                const samples = uniqueSamples(l?.samples);
                return (
                  <details key={s.id} className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <code className="w-40 shrink-0 truncate font-mono text-sm text-zinc-100">
                        {s.id}
                      </code>
                      <span className="hidden w-48 shrink-0 truncate text-xs text-zinc-500 sm:block">
                        {s.provider}
                      </span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${accessTone(s.access)}`}
                      >
                        {accessLabel(s.access)}
                      </span>
                      {s.official && (
                        <span
                          className="shrink-0 font-mono text-[9px] text-zinc-500"
                          title="counts toward the cite-or-kill official-source bar"
                        >
                          ⚖️
                        </span>
                      )}
                      <span
                        className="shrink-0 font-mono text-[10px] text-zinc-600"
                        title={TEMPORAL_META[s.temporal]?.title}
                      >
                        {TEMPORAL_META[s.temporal]?.icon}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-zinc-400">
                        {s.windowDays}d hist
                      </span>
                      <span
                        className={`w-16 shrink-0 text-right font-mono text-sm tabular-nums ${count > 0 ? 'text-[var(--color-accent)]' : 'text-zinc-600'}`}
                      >
                        {count > 0 ? count.toLocaleString() : '—'}
                      </span>
                    </summary>
                    <div className="mt-2 pl-3 text-xs text-zinc-500">
                      <p>
                        Keeps: <span className="text-zinc-400">{s.keeps}</span> · last seen{' '}
                        {relativeDays(l?.lastAt ?? 0, nowSec)}
                        {s.temporal !== 'recent' && (
                          <>
                            {' '}
                            ·{' '}
                            <span
                              className="text-zinc-400"
                              title={TEMPORAL_META[s.temporal]?.title}
                            >
                              {s.temporal === 'series'
                                ? 'time-series — history matters'
                                : 'full archive — history matters'}
                            </span>
                          </>
                        )}
                      </p>
                      {count > 0 && (
                        <Link
                          href={`/data/${encodeURIComponent(s.id)}`}
                          className="mt-2 inline-block font-mono text-[11px] text-[var(--color-accent)] underline-offset-2 hover:underline"
                        >
                          View all {count.toLocaleString()} events →
                        </Link>
                      )}
                      {samples.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {samples.map((sm) => (
                            <li key={`${s.id}-${sm.url}`} className="truncate">
                              <a
                                href={sm.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-zinc-400 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
                              >
                                {sm.title ?? sm.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        );
      })}

      <footer className="mt-12 border-t border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
        <p className="mb-1">
          Temporal: <span className="text-zinc-400">●</span> live (recent only) ·{' '}
          <span className="text-zinc-400">▤</span> archive (full history) ·{' '}
          <span className="text-zinc-400">∿</span> series (time-series, both recent + historical).
        </p>
        <p>
          Full metadata + storage model: <code>docs/source-catalog.md</code>. Grouping &amp; dedupe:{' '}
          <code>grouping.py</code>, <code>dedupe.py</code>. Catalog is generated from{' '}
          <code>source_catalog.py</code>.
        </p>
      </footer>
    </main>
  );
}
