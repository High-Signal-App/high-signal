import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type SourceAccuracyBucket } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Source accuracy — data',
  description:
    'Per-source accuracy for High Signal evidence classes. Live forward predictions and backfill calibration scored against subsequent market moves.',
  alternates: { canonical: `${SITE_URL}/data/source-accuracy` },
};

function fmtRate(value: number | null) {
  return value != null ? `${(value * 100).toFixed(0)}%` : '—';
}

export default async function SourceAccuracyPage() {
  let available = true;
  let cohorts: { live: SourceAccuracyBucket[]; backfill: SourceAccuracyBucket[] } = {
    live: [],
    backfill: [],
  };
  try {
    cohorts = await api.sourceAccuracy();
  } catch {
    available = false;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <SourceAccuracyHeader />

      {!available && (
        <section className="mb-10 border border-[var(--color-line)] p-5" role="status">
          <h2 className="font-medium text-[var(--color-fg)]">Source evidence unavailable</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
            The evidence service did not respond. Empty tables below do not mean that every source
            class has zero scored evidence. Retry this page later.
          </p>
        </section>
      )}

      {available &&
        cohorts.live.reduce((total, bucket) => total + bucket.hit + bucket.miss, 0) < 10 && (
          <p className="mb-10 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
            Small sample: fewer than 10 live signal-source contributions have directional outcomes.
            Treat percentages as calibration evidence, not proof of source quality.
          </p>
        )}

      {available && (
        <section className="mb-12">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">
            live predictions by source class
          </h2>
          <BucketTable buckets={cohorts.live} emptyHint="no live scored source evidence yet" />
        </section>
      )}

      {available && (
        <section className="mb-12">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">
            backfill calibration by source class
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
            Use backfill to spot weak source classes and scoring bias. Do not market this as proof
            of product quality.
          </p>
          <BucketTable
            buckets={cohorts.backfill}
            emptyHint="no backfill scored source evidence yet"
          />
        </section>
      )}
    </main>
  );
}

function SourceAccuracyHeader() {
  return (
    <>
      <Link
        href="/data"
        className="font-mono text-[11px] text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:underline"
      >
        ← data directory
      </Link>
      <header className="mt-4 mb-10 border-b border-zinc-800 pb-6">
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-100">
          Source accuracy
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
          Hit-rate by evidence source class. Live predictions are forward calls; backfill is
          historical replay for calibration only.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/data/hit-rate" className="border border-zinc-800 px-4 py-2 text-sm">
            hit-rate by signal type →
          </Link>
          <Link href="/track-record" className="border border-zinc-800 px-4 py-2 text-sm">
            interactive track record →
          </Link>
        </div>
      </header>
    </>
  );
}

function BucketTable({
  buckets,
  emptyHint,
}: {
  buckets: SourceAccuracyBucket[];
  emptyHint: string;
}) {
  if (buckets.length === 0) {
    return (
      <div className="mt-4 border border-dashed border-zinc-800 p-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="mt-4 max-w-full overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <tr>
            <th className="border-b border-zinc-800 py-2 text-left">source class</th>
            <th className="border-b border-zinc-800 py-2 text-right">n</th>
            <th className="border-b border-zinc-800 py-2 text-right">hit</th>
            <th className="border-b border-zinc-800 py-2 text-right">miss</th>
            <th className="border-b border-zinc-800 py-2 text-right">push</th>
            <th className="border-b border-zinc-800 py-2 text-right">hit-rate</th>
          </tr>
        </thead>
        <tbody className="nums">
          {buckets.map((b) => (
            <tr key={b.sourceType}>
              <td className="border-b border-zinc-900 py-1.5 font-mono text-xs text-zinc-300">
                {b.sourceType.replaceAll('_', ' ')}
              </td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-zinc-300">
                {b.total}
              </td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-emerald-400">
                {b.hit}
              </td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-rose-400">{b.miss}</td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-[var(--color-muted)]">
                {b.push}
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
