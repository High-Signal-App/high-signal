'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export interface Facets {
  types: { k: string; n: number }[];
  categories?: { k: string; n: number }[];
  directions: { k: string; n: number }[];
  confidences: { k: string; n: number }[];
  topEntities: { k: string; n: number }[];
  sourceClasses?: { k: string; n: number }[];
}

const ORDER = ['category', 'type', 'direction', 'confidence', 'entity'] as const;
type Key = (typeof ORDER)[number];

export function FilterBar({ facets }: { facets: Facets }) {
  const router = useRouter();
  const sp = useSearchParams();
  const hasAdvanced =
    (facets.categories?.length ?? 0) > 0 ||
    facets.types.length > 0 ||
    facets.topEntities.length > 0;

  const set = (key: Key, value: string | null) => {
    const next = new URLSearchParams(Array.from(sp.entries()));
    if (!value || value === sp.get(key)) next.delete(key);
    else next.set(key, value);
    router.push(`/signals?${next.toString()}`);
  };

  const active = (k: Key, v: string) => sp.get(k) === v;

  return (
    <section className="mt-6 border-y border-zinc-800 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-zinc-600">filter</span>
        <Group label="direction">
          {facets.directions.map((d) => (
            <Chip
              key={d.k}
              on={active('direction', d.k)}
              onClick={() => set('direction', d.k)}
              label={d.k}
              count={d.n}
              tone={d.k === 'up' ? 'up' : d.k === 'down' ? 'down' : 'muted'}
            />
          ))}
        </Group>

        <Group label="confidence">
          {facets.confidences.map((d) => (
            <Chip
              key={d.k}
              on={active('confidence', d.k)}
              onClick={() => set('confidence', d.k)}
              label={d.k}
              count={d.n}
            />
          ))}
        </Group>

        {sp.size > 0 && (
          <button
            type="button"
            className="text-zinc-500 underline-offset-4 hover:text-zinc-200 hover:underline"
            onClick={() => router.push('/signals')}
          >
            clear
          </button>
        )}
      </div>

      {hasAdvanced ? (
        <details className="mt-3 border-t border-zinc-900 pt-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-300">
            advanced facets
          </summary>
          <div className="mt-3 grid gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
            {(facets.categories?.length ?? 0) > 0 ? (
              <Group label="kind">
                {facets.categories?.slice(0, 6).map((d) => (
                  <Chip
                    key={d.k}
                    on={active('category', d.k)}
                    onClick={() => set('category', d.k)}
                    label={d.k.replaceAll('-', ' ')}
                    count={d.n}
                  />
                ))}
              </Group>
            ) : null}

            <Group label="type">
              {facets.types.slice(0, 8).map((d) => (
                <Chip
                  key={d.k}
                  on={active('type', d.k)}
                  onClick={() => set('type', d.k)}
                  label={d.k.replaceAll('_', ' ')}
                  count={d.n}
                />
              ))}
            </Group>

            <Group label="entity">
              {facets.topEntities.slice(0, 8).map((d) => (
                <Chip
                  key={d.k}
                  on={active('entity', d.k)}
                  onClick={() => set('entity', d.k)}
                  label={d.k}
                  count={d.n}
                />
              ))}
            </Group>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  label,
  count,
  on,
  onClick,
  tone = 'muted',
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
  tone?: 'up' | 'down' | 'muted';
}) {
  const toneClass =
    tone === 'up'
      ? 'border-emerald-500/40 text-emerald-400'
      : tone === 'down'
        ? 'border-rose-500/40 text-rose-400'
        : 'border-zinc-700 text-zinc-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 border px-2 py-0.5 tracking-[0.12em] transition-colors ${toneClass} ${
        on ? 'bg-white/[0.04] text-white' : 'hover:bg-white/[0.02]'
      }`}
    >
      {label}
      <span className="nums text-zinc-500">{count}</span>
    </button>
  );
}
