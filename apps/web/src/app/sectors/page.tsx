import { api } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sectors — High Signal" };

interface Props {
  searchParams: Promise<{ days?: string }>;
}

// Public: sector-level hit-rate is part of the public ledger story.
export default async function SectorsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const days = Math.min(Math.max(Number(sp.days ?? 60), 7), 365);

  let data: Awaited<ReturnType<typeof api.sectors>> = { days, sectors: [] };
  try {
    data = await api.sectors(days);
  } catch {
    /* offline */
  }

  const max = Math.max(1, ...data.sectors.map((s) => Math.abs(s.netDirection)));

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Sectors</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Net direction = confidence-weighted, time-decayed sum of signal directions per AI-infra
          sector. Hit-rate from matured signals only. <span className="text-zinc-600">Not investment advice — directional read on signal flow.</span>
        </p>
        <WindowChips active={days} />
      </header>

      {data.sectors.length === 0 ? (
        <div className="mt-12 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          no sector signals yet — first cards drop after backfill / publish
        </div>
      ) : (
        <table className="mt-8 w-full text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <tr>
              <th className="border-b border-zinc-800 py-2 text-left">sector</th>
              <th className="border-b border-zinc-800 py-2 text-left">net direction</th>
              <th className="border-b border-zinc-800 py-2 text-right">up</th>
              <th className="border-b border-zinc-800 py-2 text-right">down</th>
              <th className="border-b border-zinc-800 py-2 text-right">n</th>
              <th className="border-b border-zinc-800 py-2 text-right">hit-rate</th>
              <th className="border-b border-zinc-800 py-2 text-left">top entities</th>
            </tr>
          </thead>
          <tbody className="nums">
            {data.sectors.map((s) => {
              const pct = (s.netDirection / max) * 50; // -50..+50
              return (
                <tr key={s.sector} className="hover:bg-white/[0.02]">
                  <td className="border-b border-zinc-900 py-2 font-mono text-xs text-zinc-200">
                    {s.sector}
                  </td>
                  <td className="border-b border-zinc-900 py-2">
                    <DirBar netPct={pct} value={s.netDirection} />
                  </td>
                  <td className="border-b border-zinc-900 py-2 text-right text-emerald-400">
                    {s.upCount}
                  </td>
                  <td className="border-b border-zinc-900 py-2 text-right text-rose-400">
                    {s.downCount}
                  </td>
                  <td className="border-b border-zinc-900 py-2 text-right text-zinc-400">
                    {s.signalCount}
                  </td>
                  <td className="border-b border-zinc-900 py-2 text-right">
                    {s.hitRate != null
                      ? `${(s.hitRate * 100).toFixed(0)}%`
                      : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="border-b border-zinc-900 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.topEntities.slice(0, 5).map((e) => (
                        <a
                          key={e}
                          href={`/entities/${e}`}
                          className="border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 hover:border-zinc-600 hover:text-white"
                        >
                          {e}
                        </a>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

function WindowChips({ active }: { active: number }) {
  const opts = [7, 14, 30, 60, 90, 180, 365];
  return (
    <div className="mt-4 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
      {opts.map((d) => (
        <a
          key={d}
          href={`?days=${d}`}
          className={`border px-2 py-0.5 ${
            d === active
              ? "border-[var(--color-accent)] bg-white/[0.04] text-white"
              : "border-zinc-800 text-zinc-400 hover:bg-white/[0.02]"
          }`}
        >
          {d}d
        </a>
      ))}
    </div>
  );
}

function DirBar({ netPct, value }: { netPct: number; value: number }) {
  // netPct is in -50..+50 range; render two halves around zero
  const isUp = netPct >= 0;
  const width = Math.abs(netPct);
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-3 w-32 items-center bg-zinc-900">
        <div className="absolute left-1/2 h-full w-px bg-zinc-700" />
        {isUp ? (
          <div
            className="absolute left-1/2 h-full bg-emerald-500/60"
            style={{ width: `${width}%` }}
          />
        ) : (
          <div
            className="absolute h-full bg-rose-500/60"
            style={{ left: `${50 - width}%`, width: `${width}%` }}
          />
        )}
      </div>
      <span className={`nums w-12 font-mono text-[11px] ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
        {value > 0 ? "+" : ""}
        {value.toFixed(2)}
      </span>
    </div>
  );
}
