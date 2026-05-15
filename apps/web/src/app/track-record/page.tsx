import { api, type TrackBucket } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track record — High Signal" };

interface Cohorts {
  live: TrackBucket[];
  backfill: TrackBucket[];
  all: TrackBucket[];
}

// Public per agents.md: "Public hit-rate ledger from day 1 — moat that
// competitors can't copy without rebuilding."
export default async function TrackRecordPage() {
  let cohorts: Cohorts = { live: [], backfill: [], all: [] };
  try {
    cohorts = await api.trackRecordCohorts();
  } catch {
    /* offline */
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Track record</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every published signal is auto-scored against forward returns. No retroactive edits.
          <br />
          <span className="text-zinc-500">
            Live = forward predictions made on the day. Backfill = historical replay (calibration
            only — known data-leak risk; report separately).
          </span>
        </p>
      </header>

      <section className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
        <CohortBlock title="Live" subtitle="forward predictions" tone="accent" buckets={cohorts.live} />
        <CohortBlock
          title="Backfill"
          subtitle="historical replay · calibration only"
          tone="muted"
          buckets={cohorts.backfill}
        />
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          combined (live + backfill)
        </h2>
        <BucketTable buckets={cohorts.all} emptyHint="no scored signals yet" />
      </section>
    </main>
  );
}

function CohortBlock({
  title,
  subtitle,
  tone,
  buckets,
}: {
  title: string;
  subtitle: string;
  tone: "accent" | "muted";
  buckets: TrackBucket[];
}) {
  const overall = buckets.reduce(
    (acc, b) => {
      acc.hit += b.hit;
      acc.miss += b.miss;
      acc.push += b.push;
      acc.total += b.total;
      return acc;
    },
    { hit: 0, miss: 0, push: 0, total: 0 },
  );
  const overallHitRate =
    overall.hit + overall.miss > 0 ? overall.hit / (overall.hit + overall.miss) : null;
  const titleClass =
    tone === "accent"
      ? "text-[var(--color-accent)]"
      : "text-zinc-400";

  return (
    <div className="border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className={`font-mono text-[10px] uppercase tracking-[0.2em] ${titleClass}`}>
          {title}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          {subtitle}
        </span>
      </div>
      <div className="nums mt-4 flex items-baseline gap-4">
        <div>
          <div className="text-3xl font-medium">
            {overallHitRate != null ? `${(overallHitRate * 100).toFixed(0)}%` : "—"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            hit-rate
          </div>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-3 text-sm">
          <Stat label="hit" value={overall.hit} tone="up" />
          <Stat label="miss" value={overall.miss} tone="down" />
          <Stat label="push" value={overall.push} tone="muted" />
        </div>
      </div>
      <div className="mt-4">
        <BucketTable buckets={buckets} emptyHint={`no ${title.toLowerCase()} scored signals`} compact />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "up" | "down" | "muted";
}) {
  const cls =
    tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "text-zinc-500";
  return (
    <div>
      <div className={`text-xl font-medium ${cls}`}>{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    </div>
  );
}

function BucketTable({
  buckets,
  emptyHint,
  compact = false,
}: {
  buckets: TrackBucket[];
  emptyHint: string;
  compact?: boolean;
}) {
  if (buckets.length === 0) {
    return (
      <div className={`border border-dashed border-zinc-800 ${compact ? "p-4" : "p-10"} text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500`}>
        {emptyHint}
      </div>
    );
  }
  return (
    <table className="mt-2 w-full text-sm">
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
        {buckets
          .slice()
          .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0))
          .map((b) => (
            <tr key={b.signalType}>
              <td className="border-b border-zinc-900 py-1.5 font-mono text-xs">{b.signalType}</td>
              <td className="border-b border-zinc-900 py-1.5 text-right">{b.total}</td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-emerald-400">{b.hit}</td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-rose-400">{b.miss}</td>
              <td className="border-b border-zinc-900 py-1.5 text-right text-zinc-500">{b.push}</td>
              <td className="border-b border-zinc-900 py-1.5 text-right">
                {b.hitRate != null ? `${(b.hitRate * 100).toFixed(0)}%` : "—"}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
