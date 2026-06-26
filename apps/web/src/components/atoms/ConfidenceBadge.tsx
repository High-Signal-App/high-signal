import type { Confidence } from '@/lib/api';

const TIERS: Record<Confidence, { label: string; pips: number }> = {
  low: { label: 'low', pips: 1 },
  medium: { label: 'med', pips: 2 },
  high: { label: 'high', pips: 3 },
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const t = TIERS[confidence];
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
      <span className="flex gap-0.5">
        {['pip-1', 'pip-2', 'pip-3'].map((pipId, i) => (
          <span
            key={pipId}
            className={`block h-2 w-0.5 ${i < t.pips ? 'bg-[var(--color-accent)]' : 'bg-zinc-700'}`}
          />
        ))}
      </span>
      {t.label}
    </span>
  );
}
