import type { Context } from 'hono';

export type ServerTimingEntry = { name: string; durationMs: number };

/** Inner shared-cache (KV) outcome for one request, when the route has one. */
export type InnerCacheStatus = 'HIT' | 'MISS' | 'ERROR' | 'UNAVAILABLE' | 'BYPASS';

export type ObservedStages = { entries: ServerTimingEntry[]; innerCache?: InnerCacheStatus };

// Request-scoped side channel from route handlers to the Worker entrypoint, so
// ordinary (non-diagnostic) cache misses can report their fixed-name stage
// timings to App Health without putting them in a response header that an
// outer cache could store and replay.
const observedStages = new WeakMap<Request, ObservedStages>();

/** Remember the stage timings and inner cache outcome for this request. */
export function observeStages(
  request: Request,
  entries: ServerTimingEntry[],
  innerCache?: InnerCacheStatus
) {
  const current = observedStages.get(request);
  observedStages.set(request, {
    entries,
    innerCache: innerCache ?? current?.innerCache,
  });
}

/** Read and forget the stages a route recorded for this request. */
export function takeObservedStages(request: Request): ObservedStages | undefined {
  const observed = observedStages.get(request);
  observedStages.delete(request);
  return observed;
}

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
  entries: ServerTimingEntry[],
  enabled: boolean
) {
  observeStages(c.req.raw, entries);
  if (!enabled || !entries.length) return;
  c.header('Cache-Control', 'private, no-store');
  c.header(
    'Server-Timing',
    entries
      .map(({ name, durationMs }) => `${name};dur=${Math.max(0, durationMs).toFixed(1)}`)
      .join(', ')
  );
}
