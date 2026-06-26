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

  const set = (key: Key, value: string | null) => {
    const next = new URLSearchParams(Array.from(sp.entries()));
    if (!value || value === sp.get(key)) next.delete(key);
    else next.set(key, value);
    router.push(`/signals?${next.toString()}`);
  };

  const active = (k: Key, v: string) => sp.get(k) === v;

  return (
    <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-y border-zinc-800 py-4 font-mono text-[10px] uppercase tracking-[0.18em]">
      {(facets.categories?.length ?? 0) > 0 && (
        <Group label="kind">
          {facets.categories!.slice(0, 9).map((d) => (
            <Chip
              key={d.k}
              on={active('category', d.k)}
              onClick={() => set('category', d.k)}
              label={d.k.replaceAll('-', ' ')}
              count={d.n}
            />
          ))}
        </Group>
      )}

      <Group label="content">
        {facets.types.slice(0, 12).map((d) => (
          <Chip
            key={d.k}
            on={active('type', d.k)}
            onClick={() => set('type', d.k)}
            label={d.k.replaceAll('_', ' ')}
            count={d.n}
          />
        ))}
      </Group>

      <Group label="dir">
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

      <Group label="conf">
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

      <Group label="entity">
        {facets.topEntities.slice(0, 10).map((d) => (
          <Chip
            key={d.k}
            on={active('entity', d.k)}
            onClick={() => set('entity', d.k)}
            label={d.k}
            count={d.n}
          />
        ))}
      </Group>

      {sp.size > 0 && (
        <button
          className="text-zinc-500 underline-offset-4 hover:text-zinc-200 hover:underline"
          onClick={() => router.push('/signals')}
        >
          clear
        </button>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
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
      onClick={onClick}
      className={`flex items-center gap-1.5 border px-2 py-0.5 transition-colors ${toneClass} ${
        on ? 'bg-white/[0.04] text-white' : 'hover:bg-white/[0.02]'
      }`}
    >
      {label}
      <span className="nums text-zinc-500">{count}</span>
    </button>
  );
}
