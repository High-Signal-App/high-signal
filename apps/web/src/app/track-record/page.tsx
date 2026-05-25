import { requireAdmin } from "@/lib/clerk-admin";
import { api, type TrackBucket } from "@/lib/api";
import { TrackRecordDatasetJsonLd } from "@/components/seo/structured-data";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Public hit-rate ledger",
  description:
    "Every published High Signal market call scored against subsequent market moves. Live forward predictions and historical-replay calibrations, broken down by signal type. The moat is the number being public.",
};

interface Cohorts {
  live: TrackBucket[];
  backfill: TrackBucket[];
  all: TrackBucket[];
}

function summarizeBuckets(buckets: TrackBucket[]) {
  return buckets.reduce(
    (acc, bucket) => {
      acc.hit += bucket.hit;
      acc.miss += bucket.miss;
      acc.push += bucket.push;
      acc.total += bucket.total;
      return acc;
    },
    { hit: 0, miss: 0, push: 0, total: 0 },
  );
}

function hitRateFrom(summary: ReturnType<typeof summarizeBuckets>) {
  return summary.hit + summary.miss > 0 ? summary.hit / (summary.hit + summary.miss) : null;
}

function formatHitRate(value: number | null) {
  return value != null ? `${(value * 100).toFixed(0)}%` : "—";
}

export default async function TrackRecordPage() {
  const admin = await requireAdmin();
  const isAdmin = admin.ok;

  let cohorts: Cohorts = { live: [], backfill: [], all: [] };
  try {
    cohorts = await api.trackRecordCohorts();
  } catch {
    /* offline */
  }

  const liveCount = cohorts.live.reduce((sum, b) => sum + b.total, 0);
  const backfillCount = cohorts.backfill.reduce((sum, b) => sum + b.total, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <TrackRecordDatasetJsonLd liveCount={liveCount} backfillCount={backfillCount} />
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          public hit-rate ledger
        </div>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Track record</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every published market signal scored against subsequent market moves. Read Live first; use
          Backfill only to calibrate the scoring system.
          <br />
          <span className="text-zinc-500">
            Hit-rate excludes pushes. Push means the market move was too small or inconclusive.
          </span>
        </p>
      </header>

      <section className="mt-8 grid gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-3">
        <GuideItem label="Use for trust" value="Live" body="Forward predictions made before the scoring window closed." />
        <GuideItem label="Use for tuning" value="Backfill" body="Historical replay. Useful, but not proof of product quality." />
        <GuideItem label="Do not overread" value="Combined" body="Mixed view for debugging only; it should not be marketed yet." />
      </section>

      <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <CohortBlock
          title="Live predictions"
          subtitle="real forward calls"
          tone="accent"
          buckets={cohorts.live}
          note="This is the only section that should count for public trust later."
        />
        <CohortBlock
          title="Backfill calibration"
          subtitle="historical replay"
          tone="muted"
          buckets={cohorts.backfill}
          note="Use this to spot weak signal types and scoring bias, not to claim accuracy."
        />
      </section>

      {isAdmin ? (
        <section className="mt-12">
          <div className="flex items-baseline justify-between border-b border-zinc-800 pb-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              raw combined ledger (admin only)
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              debugging view
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
            This table mixes live and replayed rows. It is useful for finding broken signal types,
            but it should not be shown as the product's public accuracy until the live cohort is
            larger.
          </p>
          <BucketTable buckets={cohorts.all} emptyHint="no scored signals yet" />
        </section>
      ) : null}
    </main>
  );
}

function GuideItem({ label, value, body }: { label: string; value: string; body: string }) {
  return (
    <div className="bg-zinc-950/50 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-3 text-lg font-medium text-zinc-100">{value}</div>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
    </div>
  );
}

function CohortBlock({
  title,
  subtitle,
  tone,
  buckets,
  note,
}: {
  title: string;
  subtitle: string;
  tone: "accent" | "muted";
  buckets: TrackBucket[];
  note: string;
}) {
  const overall = summarizeBuckets(buckets);
  const overallHitRate = hitRateFrom(overall);
  const titleClass = tone === "accent" ? "text-[var(--color-accent)]" : "text-zinc-400";

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
            {formatHitRate(overallHitRate)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            hit-rate
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-3 text-sm">
          <Stat label="hit" value={overall.hit} tone="up" />
          <Stat label="miss" value={overall.miss} tone="down" />
          <Stat label="push" value={overall.push} tone="muted" />
        </div>
      </div>
      <p className="mt-4 border-t border-zinc-900 pt-3 text-sm leading-6 text-zinc-500">{note}</p>
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
      <div
        className={`border border-dashed border-zinc-800 ${compact ? "p-4" : "p-10"} text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500`}
      >
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
                {formatHitRate(b.hitRate)}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
