import type { Metadata, Route } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { api, type DataSourceLive } from '@/lib/api';
import { SITE_URL } from '@/lib/site';
import catalog from '@/lib/source-catalog.json';
import { ATTENTION_SOURCE_CATALOG } from '@/lib/attention-sources';

export const revalidate = 300;

const DATA_CACHE_SECONDS = 300;

const readDataSources = unstable_cache(() => api.dataSources(), ['data-sources'], {
  revalidate: DATA_CACHE_SECONDS,
});

export const metadata: Metadata = {
  title: 'Sources',
  description:
    'Every public data source High Signal ingests, with its cadence, freshness, latest run state, stored volume, and latest collected data.',
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
  cadence:
    | 'half_hourly'
    | 'daily'
    | 'context'
    | 'weekly'
    | 'monthly'
    | 'on_demand'
    | 'manual'
    | 'parked';
  expectedRunCadenceHours: number | null;
  accessBasis: string;
  contentDepth: string;
  retention: string;
  termsRisk: string;
}

const ROLE_ORDER = ['attention', 'entity', 'corroboration', 'thematic', 'numeric'] as const;
const ROLE_BLURB: Record<string, string> = {
  attention: 'Ranks what people are noticing; triggers investigation but never counts as proof.',
  entity: 'Observations typically resolve to a tracked company or organization.',
  corroboration: 'First-party or official records used to verify reported events.',
  thematic: 'Topic and keyword observations that may not resolve to one entity.',
  numeric: 'Structured series used for macro, market, and energy context.',
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

function runStatusFor(
  source: CatalogEntry,
  live: DataSourceLive | undefined
): DataSourceLive['runStatus'] {
  if (live?.runStatus) return live.runStatus;
  if (source.cadence === 'manual') return 'manual';
  if (source.cadence === 'parked') return 'parked';
  if (source.cadence === 'on_demand') return 'on_demand';
  return 'unknown';
}

function runLabelFor(status: DataSourceLive['runStatus']): string {
  const labels: Record<DataSourceLive['runStatus'], string> = {
    success_with_data: 'last run produced data',
    success_empty: 'last run: no new rows',
    failed: 'last run failed',
    manual: 'manual',
    on_demand: 'on demand',
    parked: 'parked',
    unknown: 'run status unknown',
  };
  return labels[status];
}

function SourceSummary({
  source,
  live,
  count,
  day,
  runStatus,
}: {
  source: CatalogEntry;
  live: DataSourceLive | undefined;
  count: number;
  day: string;
  runStatus: DataSourceLive['runStatus'];
}) {
  const statusLabel = `${source.cadence.replace('_', ' ')} · ${runLabelFor(runStatus)}`;
  const latestObservedAt = live?.latestObservedAt ?? live?.lastAt ?? 0;
  const observationLabel =
    count === 0 ? 'no stored rows' : latestObservedAt ? day : `${live?.futureCount ?? 0} future`;
  return (
    <>
      <code className="w-32 shrink-0 truncate font-mono text-sm text-zinc-100 sm:w-40">
        {source.id}
      </code>
      <span className="hidden w-48 shrink-0 truncate text-xs text-[var(--color-muted)] sm:block">
        {source.provider}
      </span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${accessTone(source.access)}`}
        title={source.accessBasis}
      >
        {accessLabel(source.access)}
      </span>
      {source.official && (
        <span
          className="shrink-0 font-mono text-[9px] text-[var(--color-muted)]"
          title="counts toward the cite-or-kill official-source bar"
        >
          ⚖️
        </span>
      )}
      <span
        className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]"
        title={TEMPORAL_META[source.temporal]?.title}
      >
        {TEMPORAL_META[source.temporal]?.icon}
      </span>
      <span
        className={`ml-auto hidden shrink-0 font-mono text-[10px] sm:block ${runStatus === 'failed' ? 'text-rose-400' : 'text-zinc-500'}`}
        title={statusLabel}
      >
        {statusLabel}
      </span>
      <span
        className={`ml-auto w-14 shrink-0 text-right font-mono text-sm tabular-nums sm:ml-0 sm:w-16 ${count > 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}
      >
        {count.toLocaleString()}
      </span>
      <span className="hidden w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--color-muted)] md:block">
        {observationLabel}
      </span>
    </>
  );
}

function SourceRow({
  source,
  live,
  today,
}: {
  source: CatalogEntry;
  live?: DataSourceLive;
  today: string;
}) {
  const count = live?.count ?? 0;
  const latestObservedAt = live?.latestObservedAt ?? live?.lastAt ?? 0;
  const day = isoDay(latestObservedAt, today);
  const href = latestObservedAt
    ? (`/data/${encodeURIComponent(source.id)}?date=${day}` as Route)
    : (`/data/${encodeURIComponent(source.id)}?all=1` as Route);
  const summary = (
    <SourceSummary
      source={source}
      live={live}
      count={count}
      day={day}
      runStatus={runStatusFor(source, live)}
    />
  );
  return (
    <div className="group py-2">
      {count > 0 ? (
        <Link
          href={href}
          className="-mx-1 flex items-center gap-3 rounded-sm px-1 py-1 transition-colors hover:bg-zinc-950 hover:text-zinc-100"
        >
          {summary}
        </Link>
      ) : (
        <div className="-mx-1 flex items-center gap-3 px-1 py-1">{summary}</div>
      )}
    </div>
  );
}

function SourceGroup({
  role,
  sources,
  live,
  today,
}: {
  role: (typeof ROLE_ORDER)[number];
  sources: CatalogEntry[];
  live: Record<string, DataSourceLive>;
  today: string;
}) {
  const rows = sources.filter((source) => source.role === role);
  if (rows.length === 0) return null;
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3 border-b border-zinc-800 pb-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">{role}</h2>
        <span className="text-xs text-[var(--color-muted)]">{ROLE_BLURB[role]}</span>
      </div>
      <div className="divide-y divide-zinc-900">
        {rows.map((source) => (
          <SourceRow key={source.id} source={source} live={live[source.id]} today={today} />
        ))}
      </div>
    </section>
  );
}

export default async function DataPage() {
  const sources = [
    ...ATTENTION_SOURCE_CATALOG,
    ...(catalog.sources as CatalogEntry[]),
  ] as CatalogEntry[];
  const today = new Date().toISOString().slice(0, 10);

  let live: Record<string, DataSourceLive> = {};
  let available = false;
  let liveTotal = 0;
  let sourceStatusGeneratedAt: string | null = null;
  try {
    const res = await readDataSources();
    available = res.available;
    liveTotal = res.total;
    sourceStatusGeneratedAt = res.generatedAt;
    live = Object.fromEntries(res.sources.map((s) => [s.id, s]));
  } catch {
    /* worker/D1 unavailable — render the catalog without live counts */
  }

  const storedSourceCount = sources.filter((s) => (live[s.id]?.count ?? 0) > 0).length;
  const cadenceCounts = {
    halfHourly: sources.filter((s) => s.cadence === 'half_hourly').length,
    daily: sources.filter((s) => s.cadence === 'daily').length,
    context: sources.filter((s) => s.cadence === 'context').length,
    weekly: sources.filter((s) => s.cadence === 'weekly').length,
    monthly: sources.filter((s) => s.cadence === 'monthly').length,
    onDemand: sources.filter((s) => s.cadence === 'on_demand').length,
    manual: sources.filter((s) => s.cadence === 'manual').length,
    parked: sources.filter((s) => s.cadence === 'parked').length,
  };
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
          source directory
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
          {sources.length} data sources
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
          The configured source-family inventory behind High Signal. Stored records always keep
          provenance and a canonical link; depending on the adapter, D1 may also retain bounded
          article text, filings, transcripts, reviews, or selected structured payloads. Another
          publisher becomes corroboration only after semantic agreement and independent-origin
          checks—not from a hostname count alone.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs tabular-nums text-zinc-400">
          <span>
            <span className="text-zinc-100">{sources.length}</span> sources
          </span>
          <span>
            <span className="text-[var(--color-accent)]">{storedSourceCount}</span> with stored
            history
          </span>
          {available && (
            <span>
              <span className="text-zinc-100">{liveTotal.toLocaleString()}</span> events in store
            </span>
          )}
          <span title="Included in the scheduled daily all-source ingestion run">
            <span className="text-zinc-100">{cadenceCounts.daily}</span> scheduled daily
          </span>
          <span title="Derived attention feeds polled every 30 minutes">
            <span className="text-zinc-100">{cadenceCounts.halfHourly}</span> every 30 min
          </span>
          <span title="Refreshed separately for ranking and calibration, not direct evidence">
            <span className="text-zinc-100">{cadenceCounts.context}</span> context
          </span>
          <span title="Collected once per week">
            <span className="text-zinc-100">{cadenceCounts.weekly}</span> weekly
          </span>
          <span title="Collected once per month">
            <span className="text-zinc-100">{cadenceCounts.monthly}</span> monthly
          </span>
          <span title="Fetched only during explicit investigation">
            <span className="text-zinc-100">{cadenceCounts.onDemand}</span> on demand
          </span>
          <span title="Run explicitly for enrichment or backfill">
            <span className="text-zinc-100">{cadenceCounts.manual}</span> manual
          </span>
          <span title="Excluded from scheduled ingestion">
            <span className="text-zinc-100">{cadenceCounts.parked}</span> parked
          </span>
        </div>
        {sourceStatusGeneratedAt && (
          <p className="mt-2 font-mono text-[10px] text-[var(--color-muted)]">
            Source status generated {new Date(sourceStatusGeneratedAt).toISOString()} · stored rows
            are inventory, not proof that an adapter is currently healthy.
          </p>
        )}
        {!available && (
          <p className="mt-3 font-mono text-[11px] text-amber-400/80">
            Live counts unavailable (events store not reachable) — showing the catalog. Regenerate
            samples locally with <code>python -m high_signal_ingest.data_directory</code>.
          </p>
        )}
      </header>

      {ROLE_ORDER.map((role) => (
        <SourceGroup key={role} role={role} sources={sources} live={live} today={today} />
      ))}

      <footer className="mt-12 border-t border-zinc-800 pt-4 font-mono text-[11px] text-[var(--color-muted)]">
        <p className="mb-1">
          Temporal: <span className="text-zinc-400">●</span> live (recent only) ·{' '}
          <span className="text-zinc-400">▤</span> archive (full history) ·{' '}
          <span className="text-zinc-400">∿</span> series (time-series, both recent + historical).
        </p>
        <p>
          Full metadata + storage model: <code>docs/operations/source-catalog.md</code>. Source
          audit: <code>docs/operations/data-source-audit.md</code>. Catalog is generated from{' '}
          <code>source_catalog.py</code>.
        </p>
      </footer>
    </main>
  );
}
