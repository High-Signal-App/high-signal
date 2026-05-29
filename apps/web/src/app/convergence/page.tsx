import { api } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cross-Source Convergence — High Signal" };

interface Props {
  searchParams: Promise<{ hours?: string; min_sources?: string }>;
}

function formatRelative(unixSec: number, nowSec: number): string {
  const diff = nowSec - unixSec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const WINDOW_CHOICES = [6, 12, 24, 48, 72];
const MIN_CHOICES = [2, 3, 4, 5];

function Chip({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <a
      href={href}
      className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
        active
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      }`}
    >
      {label}
    </a>
  );
}

export default async function ConvergencePage({ searchParams }: Props) {
  const sp = await searchParams;
  const hours = Math.min(Math.max(Number(sp.hours ?? 24), 1), 24 * 30);
  const minSources = Math.min(Math.max(Number(sp.min_sources ?? 3), 2), 10);

  let data: Awaited<ReturnType<typeof api.convergence>> = {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    minSources,
    rows: [],
  };
  try {
    data = await api.convergence(hours, minSources);
  } catch {
    /* offline */
  }

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Cross-source convergence</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Entities hit by <strong>≥ {minSources}</strong> distinct sources in the last{" "}
          <strong>{hours}h</strong>. The strongest pre-news pattern in the system: when news,
          Reddit, EDGAR, IR, and prediction markets fire on the same name within hours, something
          is happening.{" "}
          <span className="text-zinc-600">
            Not investment advice — surface for triage, not for trading.
          </span>
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            window
          </span>
          {WINDOW_CHOICES.map((h) => (
            <Chip
              key={h}
              label={`${h}h`}
              active={hours === h}
              href={`/convergence?hours=${h}&min_sources=${minSources}`}
            />
          ))}
          <span className="ml-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            min sources
          </span>
          {MIN_CHOICES.map((m) => (
            <Chip
              key={m}
              label={`≥${m}`}
              active={minSources === m}
              href={`/convergence?hours=${hours}&min_sources=${m}`}
            />
          ))}
        </div>
      </header>

      {data.rows.length === 0 ? (
        <div className="mt-12 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          no entity hit by ≥{minSources} sources in the last {hours}h
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {data.rows.map((row) => (
            <article
              key={row.entityId}
              className="border border-zinc-800 p-4 hover:border-zinc-700"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <a
                    href={`/entities/${encodeURIComponent(row.entityId)}`}
                    className="font-mono text-sm text-zinc-100 hover:text-[var(--color-accent)]"
                  >
                    {row.ticker ?? row.entityId}
                  </a>
                  {row.name ? (
                    <span className="ml-2 text-sm text-zinc-400">{row.name}</span>
                  ) : null}
                  {row.sector ? (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                      {row.sector}
                    </span>
                  ) : null}
                  {row.isNew ? (
                    <span className="ml-2 rounded border border-emerald-700/60 px-1.5 py-0 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                      new
                    </span>
                  ) : null}
                  {row.label === "breakout" ? (
                    <span
                      className="ml-2 rounded border border-amber-600/60 px-1.5 py-0 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300"
                      title={row.labelReason ?? ""}
                    >
                      breakout
                    </span>
                  ) : null}
                  {row.label === "divergence" ? (
                    <span
                      className="ml-2 rounded border border-violet-600/60 px-1.5 py-0 font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300"
                      title={row.labelReason ?? ""}
                    >
                      divergence
                    </span>
                  ) : null}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  <span className="text-[var(--color-accent)]">{row.sourceCount} sources</span>
                  <span className="ml-3 text-zinc-600">{row.eventCount} events</span>
                  <span className="ml-3 text-zinc-600">{formatRelative(row.latestAt, nowSec)}</span>
                </div>
              </header>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.sources.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                  >
                    {s}
                  </span>
                ))}
              </div>
              {row.attention ? (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-zinc-800 pl-3 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    attention · 30d
                  </span>
                  <span className="font-mono text-zinc-300">
                    {row.attention.totalViews.toLocaleString()} views
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {row.attention.avgPerDay.toLocaleString()}/day avg
                  </span>
                  {row.attention.trendDirection && row.attention.trendDeltaPct != null ? (
                    <span
                      className={`ml-auto font-mono text-[11px] ${
                        row.attention.trendDirection === "up"
                          ? "text-emerald-300"
                          : row.attention.trendDirection === "down"
                            ? "text-red-300"
                            : "text-zinc-500"
                      }`}
                    >
                      7d vs prior:{" "}
                      {row.attention.trendDeltaPct >= 0 ? "+" : ""}
                      {row.attention.trendDeltaPct.toFixed(0)}%
                    </span>
                  ) : null}
                </div>
              ) : null}
              {row.marketQuote ? (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-zinc-800 pl-3 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    market · {row.marketQuote.source}
                  </span>
                  <a
                    href={row.marketQuote.marketUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-zinc-300 hover:text-[var(--color-accent)]"
                  >
                    {row.marketQuote.question}
                  </a>
                  <span className="ml-auto font-mono text-zinc-300">
                    {(row.marketQuote.probNow * 100).toFixed(0)}%
                  </span>
                  {row.marketQuote.probChange != null ? (
                    <span
                      className={`font-mono text-[11px] ${
                        row.marketQuote.probChange > 0.02
                          ? "text-emerald-300"
                          : row.marketQuote.probChange < -0.02
                            ? "text-red-300"
                            : "text-zinc-500"
                      }`}
                    >
                      {row.marketQuote.probChange >= 0 ? "+" : ""}
                      {(row.marketQuote.probChange * 100).toFixed(1)} pp
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-zinc-600">new</span>
                  )}
                </div>
              ) : null}
              {row.recent.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-zinc-900 pt-3 text-sm">
                  {row.recent.map((ev, i) => (
                    <li key={i} className="flex flex-wrap gap-2 text-zinc-300">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                        {ev.source}
                      </span>
                      <a
                        href={ev.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex-1 hover:text-[var(--color-accent)]"
                      >
                        {ev.title ?? ev.source_url}
                      </a>
                      <span className="font-mono text-[10px] text-zinc-600">
                        {formatRelative(ev.published_at, nowSec)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
