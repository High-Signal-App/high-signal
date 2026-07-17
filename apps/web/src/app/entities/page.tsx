import { api, type EntityRow } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entities' };

// Public: the entity corpus is part of the signal context that consumers
// of /signals need to navigate the spillover graph.
export default async function EntitiesPage() {
  let entities: EntityRow[] = [];
  try {
    const r = await api.entities();
    entities = r.entities;
  } catch {
    /* offline */
  }

  const bySector = new Map<string, EntityRow[]>();
  for (const e of entities) {
    const k = e.sector ?? 'other';
    bySector.set(k, [...(bySector.get(k) ?? []), e]);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Entities</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        AI-infra graph. Public companies + key private players. Click an entity for relationships +
        signal history.
      </p>

      <div className="mt-12 space-y-12">
        {Array.from(bySector.entries())
          .sort()
          .map(([sector, list]) => (
            <section key={sector}>
              <h2 className="border-b border-zinc-800 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                {sector} <span className="text-zinc-700">·</span>{' '}
                <span className="nums">{list.length}</span>
              </h2>
              <ul className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                {list
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map((e) => (
                    <li key={e.id}>
                      <a
                        href={`/entities/${e.id}`}
                        className="flex items-baseline justify-between gap-2 border-b border-zinc-900 py-2 transition-colors hover:bg-white/[0.02]"
                      >
                        <span className="font-mono text-xs text-[var(--color-accent)]">{e.id}</span>
                        <span className="truncate text-xs text-zinc-400">{e.name}</span>
                      </a>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
      </div>
    </main>
  );
}
