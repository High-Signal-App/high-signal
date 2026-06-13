import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { SignalCard } from "@/components/molecules/SignalCard";
import { SpilloverGraph } from "@/components/organisms/SpilloverGraph";
import WatchButton from "./WatchButton";

export const dynamic = "force-dynamic";

// Public: individual entity pages list the public signals tied to that entity.
export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await api.entity(id);
  } catch {
    return notFound();
  }
  const { entity, relationships, signals, marketQuotes = [] } = data;

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/entities"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← entities
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {entity.ticker && <span className="text-[var(--color-accent)]">{entity.ticker}</span>}
          {entity.country && <span>{entity.country}</span>}
          {entity.sector && <span>{entity.sector}</span>}
          <span>{entity.type}</span>
        </div>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-3xl font-medium tracking-tight">{entity.name}</h1>
          <WatchButton entityId={entity.id} />
        </div>
      </header>

      <section className="mt-10 grid gap-12 md:grid-cols-[480px_1fr] md:gap-8">
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            spillover graph <span className="nums">{relationships.length}</span>
          </h2>
          <div className="mt-4">
            {relationships.length > 0 ? (
              <SpilloverGraph primary={entity.id} relationships={relationships} />
            ) : (
              <div className="border border-dashed border-zinc-800 p-10 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                no relationships seeded yet
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            relationship list
          </h2>
          <ul className="mt-4 divide-y divide-zinc-900">
            {relationships
              .slice()
              .sort((a, b) => b.weight - a.weight)
              .map((r) => {
                const other = r.fromEntityId === entity.id ? r.toEntityId : r.fromEntityId;
                const dir = r.fromEntityId === entity.id ? "→" : "←";
                return (
                  <li
                    key={r.id}
                    className="flex items-baseline justify-between gap-3 py-2 font-mono text-xs"
                  >
                    <span className="flex items-baseline gap-3">
                      <span className="text-zinc-600">{dir}</span>
                      <a
                        href={`/entities/${other}`}
                        className="text-zinc-200 hover:text-white"
                      >
                        {other}
                      </a>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        {r.type}
                      </span>
                    </span>
                    <span className="nums text-[10px] text-zinc-500">{r.weight.toFixed(2)}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      </section>

      {marketQuotes.length > 0 && (
        <section className="mt-12">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            market consensus <span className="nums">{marketQuotes.length}</span>
            <span className="ml-2 text-zinc-700">prediction-market quotes (latest)</span>
          </h2>
          <ul className="mt-4 divide-y divide-zinc-900">
            {marketQuotes.map((q) => {
              const pct = Math.round(q.prob * 100);
              const tone =
                pct >= 65 ? "text-emerald-400" : pct <= 35 ? "text-rose-400" : "text-zinc-300";
              return (
                <li key={q.id} className="flex items-baseline gap-4 py-3">
                  <span
                    className={`nums w-14 shrink-0 font-mono text-lg font-medium ${tone}`}
                  >
                    {pct}%
                  </span>
                  <a
                    href={q.marketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-sm text-zinc-200 hover:text-white"
                  >
                    {q.question}
                  </a>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {q.source}
                  </span>
                  {q.volume != null && (
                    <span className="nums font-mono text-[10px] text-zinc-600">
                      ${formatVolume(q.volume)}
                    </span>
                  )}
                  {q.resolved && (
                    <span className="border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                      resolved {q.resolvedOutcome ?? ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          recent signals
        </h2>
        {signals.length === 0 ? (
          <div className="mt-4 border border-dashed border-zinc-800 p-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            no signals yet
          </div>
        ) : (
          <div className="mt-4 border-t border-zinc-800">
            {signals.map((s) => (
              <SignalCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
