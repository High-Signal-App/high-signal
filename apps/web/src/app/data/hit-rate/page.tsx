import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type TrackBucket } from '@/lib/api';
import { TrackRecordDatasetJsonLd } from '@/components/seo/structured-data';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Public hit-rate ledger — data',
  description:
    'Downloadable, public hit-rate ledger for every High Signal market call. Live forward predictions and backfill calibration by signal type, scored against subsequent market moves. CC-BY-4.0.',
  alternates: { canonical: `${SITE_URL}/data/hit-rate` },
};

function summarize(buckets: TrackBucket[]) {
  return buckets.reduce(
    (acc, b) => {
      acc.hit += b.hit;
      acc.miss += b.miss;
      acc.push += b.push;
      acc.total += b.total;
      return acc;
    },
    { hit: 0, miss: 0, push: 0, total: 0 }
  );
}

function hitRate(hit: number, miss: number) {
  return hit + miss > 0 ? hit / (hit + miss) : null;
}

function fmtRate(value: number | null) {
  return value != null ? `${(value * 100).toFixed(0)}%` : '—';
}

async function loadCohorts(): Promise<{
  available: boolean;
  live: TrackBucket[];
  backfill: TrackBucket[];
  all: TrackBucket[];
}> {
  try {
    return { available: true, ...(await api.trackRecordCohorts()) };
  } catch {
    return {
      available: false,
      live: [],
      backfill: [],
      all: [],
    };
  }
}

export default async function HitRateDataPage() {
  const { available, ...cohorts } = await loadCohorts();

  const live = summarize(cohorts.live);
  const backfill = summarize(cohorts.backfill);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {available && (
        <TrackRecordDatasetJsonLd liveCount={live.total} backfillCount={backfill.total} />
      )}

      <LedgerHeader />
      <LedgerContent available={available} cohorts={cohorts} live={live} backfill={backfill} />
      <LedgerSchema />
    </main>
  );
}

function LedgerHeader() {
  return (
    <div>
      <Link
        href="/data"
        className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:underline"
      >
        ← data directory
      </Link>
      <header className="mt-4 mb-10 border-b border-zinc-800 pb-6">
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-100">
          Public hit-rate ledger
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
          Every published High Signal market call scored against subsequent market moves. Live =
          forward predictions made before the scoring window closed. Backfill = historical replay
          used to calibrate scoring. Push means the move was too small to call. Hit-rate excludes
          pushes. Licensed CC-BY-4.0.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href="/data/hit-rate.json"
            className="border border-[var(--color-accent)]/60 px-4 py-2 font-mono text-[11px] uppercase text-[var(--color-accent)]"
          >
            ↓ hit-rate.json
          </a>
          <a
            href="/data/hit-rate.csv"
            className="border border-zinc-800 px-4 py-2 font-mono text-[11px] uppercase text-zinc-400"
          >
            ↓ hit-rate.csv
          </a>
          <Link
            href="/track-record"
            className="border border-zinc-800 px-4 py-2 font-mono text-[11px] uppercase text-zinc-400"
          >
            interactive track record →
          </Link>
        </div>
      </header>
    </div>
  );
}

function LedgerContent({
  available,
  cohorts,
  live,
  backfill,
}: {
  available: boolean;
  cohorts: { live: TrackBucket[]; backfill: TrackBucket[]; all: TrackBucket[] };
  live: ReturnType<typeof summarize>;
  backfill: ReturnType<typeof summarize>;
}) {
  return available ? (
    <AvailableLedger cohorts={cohorts} live={live} backfill={backfill} />
  ) : (
    <section className="mb-10 border border-[var(--color-line)] p-5" role="status">
      <h2 className="font-medium">Ledger temporarily unavailable</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        The evidence service did not respond. This is not a zero-result dataset. Retry this page or
        its downloads later.
      </p>
    </section>
  );
}

function LedgerSchema() {
  const rows = [
    ['signal_type', 'The signal type slug.'],
    ['cohort', 'Live or backfill.'],
    ['hit', 'Moved in the predicted direction.'],
    ['miss', 'Moved against the prediction.'],
    ['push', 'Move was too small to call.'],
    ['pending', 'Scoring window has not closed.'],
    ['total', 'hit + miss + push + pending.'],
    ['hit_rate', 'hits / (hits + misses).'],
  ];
  return (
    <section className="border border-zinc-800 p-5">
      <h2 className="font-mono text-xs uppercase">schema</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt className="font-mono text-xs text-[var(--color-accent)]">{key}</dt>
            <dd className="text-zinc-400">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MetricBox({
  label,
  value,
  sub,
  tone = 'muted',
}: {
  label: string;
  value: number;
  sub: string;
  tone?: 'accent' | 'muted';
}) {
  const valueClass = tone === 'accent' ? 'text-[var(--color-accent)]' : 'text-zinc-100';
  return (
    <div className="bg-zinc-950/50 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        {label}
      </div>
      <div className={`nums mt-2 text-2xl font-medium ${valueClass}`}>{value.toLocaleString()}</div>
      <div className="mt-1 font-mono text-[10px] text-[var(--color-muted)]">{sub}</div>
    </div>
  );
}

function BucketTable({ buckets, emptyHint }: { buckets: TrackBucket[]; emptyHint: string }) {
  if (buckets.length === 0) {
    return (
      <div className="mt-4 border border-dashed border-zinc-800 p-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="mt-4 max-w-full overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <tr>
            <th className="border-b border-zinc-800 py-2 text-left">type</th>
            <th className="border-b border-zinc-800 py-2 text-right">n</th>
            <th className="border-b border-zinc-800 py-2 text-right">hit</th>
            <th className="border-b border-zinc-800 py-2 text-right">miss</th>
            <th className="border-b border-zinc-800 py-2 text-right">push</th>
            <th className="border-b border-zinc-800 py-2 text-right">pending</th>
            <th className="border-b border-zinc-800 py-2 text-right">hit-rate</th>
          </tr>
        </thead>
        <tbody className="nums">
          {buckets
            .slice()
            .sort((a, b) => b.total - a.total)
            .map((b) => (
              <tr key={b.signalType}>
                <td className="border-b border-zinc-900 py-1.5 font-mono text-xs text-zinc-300">
                  {b.signalType.replaceAll('_', ' ')}
                </td>
                <td className="border-b border-zinc-900 py-1.5 text-right text-zinc-300">
                  {b.total}
                </td>
                <td className="border-b border-zinc-900 py-1.5 text-right text-emerald-400">
                  {b.hit}
                </td>
                <td className="border-b border-zinc-900 py-1.5 text-right text-rose-400">
                  {b.miss}
                </td>
                <td className="border-b border-zinc-900 py-1.5 text-right text-[var(--color-muted)]">
                  {b.push}
                </td>
                <td className="border-b border-zinc-900 py-1.5 text-right text-[var(--color-muted)]">
                  {b.pending}
                </td>
                <td className="border-b border-zinc-900 py-1.5 text-right text-zinc-200">
                  {fmtRate(b.hitRate)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function AvailableLedger({
  cohorts,
  live,
  backfill,
}: {
  cohorts: { live: TrackBucket[]; backfill: TrackBucket[]; all: TrackBucket[] };
  live: ReturnType<typeof summarize>;
  backfill: ReturnType<typeof summarize>;
}) {
  return (
    <div>
      <section className="mb-10 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
        <MetricBox
          label="live predictions"
          value={live.total}
          sub={`${fmtRate(hitRate(live.hit, live.miss))} hit-rate · ${live.hit} hit · ${live.miss} miss`}
          tone="accent"
        />
        <MetricBox
          label="backfill calibration"
          value={backfill.total}
          sub={`${fmtRate(hitRate(backfill.hit, backfill.miss))} hit-rate · ${backfill.hit} hit · ${backfill.miss} miss`}
        />
        <MetricBox
          label="signal types scored"
          value={cohorts.live.length}
          sub={`${cohorts.live.length + cohorts.backfill.length} across live + backfill`}
        />
      </section>
      {live.hit + live.miss < 10 && (
        <p className="mb-10 text-sm text-[var(--color-muted)]">
          Small sample: only {live.hit + live.miss} live predictions have a directional outcome.
          Treat this as calibration evidence, not proof.
        </p>
      )}
      <section className="mb-12">
        <h2 className="font-mono text-xs uppercase">live predictions by signal type</h2>
        <BucketTable buckets={cohorts.live} emptyHint="no live scored predictions yet" />
      </section>
      <section className="mb-12">
        <h2 className="font-mono text-xs uppercase text-[var(--color-muted)]">
          backfill calibration by signal type
        </h2>
        <BucketTable buckets={cohorts.backfill} emptyHint="no backfill scored predictions yet" />
      </section>
    </div>
  );
}
