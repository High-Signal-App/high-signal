import type { Context } from 'hono';

export type ServerTimingEntry = { name: string; durationMs: number };

export async function timeServerStage<T>(
  entries: ServerTimingEntry[],
  name: string,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    entries.push({ name, durationMs: performance.now() - startedAt });
  }
}

export function setServerTiming<B extends object>(
  c: Context<{ Bindings: B }>,
  entries: ServerTimingEntry[]
) {
  if (!entries.length) return;
  c.header(
    'Server-Timing',
    entries
      .map(({ name, durationMs }) => `${name};dur=${Math.max(0, durationMs).toFixed(1)}`)
      .join(', ')
  );
}
