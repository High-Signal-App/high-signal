import type { Direction } from '@/lib/api';

const STYLES: Record<Direction, string> = {
  up: 'border-emerald-500/40 text-emerald-400',
  down: 'border-rose-500/40 text-rose-400',
  neutral: 'border-zinc-600 text-zinc-400',
};

export function DirectionPill({ direction }: { direction: Direction }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${STYLES[direction]}`}
    >
      <span className="size-1 rounded-full bg-current" />
      {direction}
    </span>
  );
}
