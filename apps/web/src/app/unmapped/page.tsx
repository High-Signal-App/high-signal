import { api } from "@/lib/api";
import { PromoteButton } from "@/components/unmapped/PromoteButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gazetteer Candidates — High Signal" };

interface Props {
  searchParams: Promise<{ hours?: string; top?: string }>;
}

const WINDOW_CHOICES = [24, 72, 168, 720];

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

function formatRelative(unixSec: number, nowSec: number): string {
  const diff = nowSec - unixSec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default async function UnmappedPage({ searchParams }: Props) {
  const sp = await searchParams;
  const hours = Math.min(Math.max(Number(sp.hours ?? 24), 1), 24 * 30);
  const top = Math.min(Math.max(Number(sp.top ?? 30), 1), 200);

  let data: Awaited<ReturnType<typeof api.unmapped>> = {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    eventsScanned: 0,
    candidates: [],
  };
  try {
    data = await api.unmapped(hours, top);
  } catch {
    /* offline */
  }

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Gazetteer candidates</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          $TICKER tokens that appeared in events with <em>no</em> entity match in the last{" "}
          <strong>{hours}h</strong>. Top tokens are the strongest candidates to add to{" "}
          <code className="bg-zinc-900 px-1">ai_infra_entities.csv</code>. Scanned{" "}
          <strong>{data.eventsScanned}</strong> unmapped events.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            window
          </span>
          {WINDOW_CHOICES.map((h) => (
            <Chip
              key={h}
              label={h >= 168 ? `${Math.floor(h / 24)}d` : `${h}h`}
              active={hours === h}
              href={`/unmapped?hours=${h}&top=${top}`}
            />
          ))}
        </div>
      </header>

      {data.candidates.length === 0 ? (
        <div className="mt-12 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          no unmapped $tickers in the last {hours}h
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {data.candidates.map((c) => (
            <article
              key={c.token}
              className="border border-zinc-800 p-4 hover:border-zinc-700"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-sm text-zinc-100">{c.token}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {c.count} mentions
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.sources.map((s) => (
                    <span
                      key={s}
                      className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    >
                      {s}
                    </span>
                  ))}
                  <PromoteButton token={c.token} />
                </div>
              </header>
              {c.samples.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-zinc-900 pt-3 text-sm">
                  {c.samples.map((s, i) => (
                    <li key={i} className="flex flex-wrap gap-2 text-zinc-300">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                        {s.source}
                      </span>
                      <a
                        href={s.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex-1 hover:text-[var(--color-accent)]"
                      >
                        {s.title}
                      </a>
                      <span className="font-mono text-[10px] text-zinc-600">
                        {formatRelative(s.published_at, nowSec)}
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
