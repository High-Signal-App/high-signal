import type { Metadata, Route } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { api, type DataSourceLive, type TrackBucket } from '@/lib/api';
import { TrackRecordDatasetJsonLd } from '@/components/seo/structured-data';
import { SITE_URL } from '@/lib/site';
import catalog from '@/lib/source-catalog.json';

export const revalidate = 86400;

const DATA_CACHE_SECONDS = 86400;

const readDataSources = unstable_cache(() => api.dataSources(), ['data-sources'], {
  revalidate: DATA_CACHE_SECONDS,
});

export const metadata: Metadata = {
  title: 'Data — sources + hit-rate ledger',
  description:
    'Every public source High Signal ingests, plus the public hit-rate ledger: downloadable JSON and CSV of every published market signal scored against subsequent moves.',
  alternates: { canonical: `${SITE_URL}/data` },
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

function isoDay(unixSec: number, fallback: string): string {
  if (!unixSec) return fallback;
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export default async function DataPage() {
  const sources = catalog.sources as CatalogEntry[];
  const today = new Date().toISOString().slice(0, 10);

  let live: Record<string, DataSourceLive> = {};
  let available = false;
  let liveTotal = 0;
  try {
    const res = await readDataSources();
    available = res.available;
    liveTotal = res.total;
    live = Object.fromEntries(res.sources.map((s) => [s.id, s]));
  } catch {
    /* worker/D1 unavailable — render the catalog without live counts */
  }

  // Hit-rate ledger data for the public dataset section.
  let cohorts: { live: TrackBucket[]; backfill: TrackBucket[]; all: TrackBucket[] } = {
    live: [],
    backfill: [],
    all: [],
  };
  try {
    cohorts = await api.trackRecordCohorts();
  } catch {
    /* offline */
  }
  const liveCount2 = cohorts.live.reduce((sum, b) => sum + b.total, 0);
  const backfillCount = cohorts.backfill.reduce((sum, b) => sum + b.total, 0);

  const liveCount = sources.filter((s) => (live[s.id]?.count ?? 0) > 0).length;
  const temporalCounts = {
    recent: sources.filter((s) => s.temporal === 'recent').length,
    historical: sources.filter((s) => s.temporal === 'historical').length,
    series: sources.filter((s) => s.temporal === 'series').length,
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <TrackRecordDatasetJsonLd liveCount={liveCount2} backfillCount={backfillCount} />
      <header className="mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          Data directory + hit-rate ledger
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
          {sources.length} data sources · {liveCount2 + backfillCount} scored predictions
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

      {/* Hit-rate ledger — the citable dataset */}
      <section className="mb-12 border border-zinc-800 bg-zinc-950/40 p-5" aria-labelledby="hitrate-dataset-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <h2
              id="hitrate-dataset-heading"
              className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-accent)]"
            >
              public hit-rate ledger — downloadable dataset
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Every published market signal scored against subsequent moves. Hit-rate excludes
              pushes. Live = forward predictions made before the scoring window closed; Backfill =
              historical replay calibration. The dataset is the competitive moat — competitors
              cannot copy it without rebuilding the history from scratch.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              live predictions
            </div>
            <div className="nums mt-2 text-2xl font-medium text-zinc-100">{liveCount2}</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">forward calls</div>
          </div>
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              backfill calibration
            </div>
            <div className="nums mt-2 text-2xl font-medium text-zinc-400">{backfillCount}</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">historical replay</div>
          </div>
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              signal types (live)
            </div>
            <div className="nums mt-2 text-2xl font-medium text-zinc-100">{cohorts.live.length}</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">distinct types scored</div>
          </div>
        </div>

        <div className="mt-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            download
          </h3>
          <div className="mt-3 flex flex-wrap gap-3">
            <a
              href="/data/hit-rate.json"
              className="border border-[var(--color-accent)]/60 bg-cyan-400/5 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)] hover:border-[var(--color-accent)]"
            >
              ↓ hit-rate.json
            </a>
            <a
              href="/data/hit-rate.csv"
              className="border border-zinc-800 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            >
              ↓ hit-rate.csv
            </a>
            <Link
              href="/track-record"
              className="border border-zinc-800 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            >
              view interactive ledger →
            </Link>
          </div>
          <p className="mt-3 font-mono text-[10px] text-zinc-600">
            License: CC-BY-4.0. Cite as &ldquo;High Signal Public Hit-Rate Ledger&rdquo; with the
            download date. Schema: signal_type, cohort, hit, miss, push, pending, total, hit_rate.
          </p>
        </div>

        {cohorts.live.length > 0 ? (
          <div className="mt-5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              live predictions by signal type
            </h3>
            <table className="mt-3 w-full text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-800 py-2 text-left">type</th>
                  <th className="border-b border-zinc-800 py-2 text-right">n</th>
                  <th className="border-b border-zinc-800 py-2 text-right">hit</th>
                  <th className="border-b border-zinc-800 py-2 text-right">miss</th>
                  <th className="border-b border-zinc-800 py-2 text-right">push</th>
                  <th className="border-b border-zinc-800 py-2 text-right">hit-rate</th>
                </tr>
              </thead>
              <tbody className="nums">
                {cohorts.live
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map((b) => (
                    <tr key={b.signalType}>
                      <td className="border-b border-zinc-900 py-1.5 font-mono text-xs">
                        {b.signalType.replaceAll('_', ' ')}
                      </td>
                      <td className="border-b border-zinc-900 py-1.5 text-right">{b.total}</td>
                      <td className="border-b border-zinc-900 py-1.5 text-right text-emerald-400">
                        {b.hit}
                      </td>
                      <td className="border-b border-zinc-900 py-1.5 text-right text-rose-400">
                        {b.miss}
                      </td>
                      <td className="border-b border-zinc-900 py-1.5 text-right text-zinc-500">
                        {b.push}
                      </td>
                      <td className="border-b border-zinc-900 py-1.5 text-right">
                        {b.hitRate != null ? `${(b.hitRate * 100).toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 border border-dashed border-zinc-800 p-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no scored predictions yet — the ledger populates as signals mature
          </p>
        )}
      </section>

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
                const day = isoDay(l?.lastAt ?? 0, today);
                const href = `/data/${encodeURIComponent(s.id)}?date=${day}` as Route;
                const sourceSummary = (
                  <>
                    <code className="w-32 shrink-0 truncate font-mono text-sm text-zinc-100 sm:w-40">
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
                    <span className="ml-auto hidden shrink-0 font-mono text-xs tabular-nums text-zinc-400 sm:block">
                      {s.windowDays}d hist
                    </span>
                    <span
                      className={`ml-auto w-14 shrink-0 text-right font-mono text-sm tabular-nums sm:ml-0 sm:w-16 ${count > 0 ? 'text-[var(--color-accent)]' : 'text-zinc-600'}`}
                    >
                      {count > 0 ? count.toLocaleString() : '—'}
                    </span>
                    <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-600 md:block">
                      {count > 0 ? day : 'no data'}
                    </span>
                  </>
                );
                return (
                  <div key={s.id} className="group py-2">
                    {count > 0 ? (
                      <Link
                        href={href}
                        className="-mx-1 flex items-center gap-3 rounded-sm px-1 py-1 transition-colors hover:bg-zinc-950 hover:text-zinc-100"
                      >
                        {sourceSummary}
                      </Link>
                    ) : (
                      <div className="-mx-1 flex items-center gap-3 px-1 py-1 opacity-60">
                        {sourceSummary}
                      </div>
                    )}
                  </div>
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
