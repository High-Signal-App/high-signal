/**
 * Bounded resilience helpers for external provider calls.
 *
 * Reuses the same full-jitter backoff discipline as the Python pipeline
 * (`_with_backoff` in pipeline.py): exponential base × 2^(attempt-1), capped,
 * then uniform-randomized between 0 and the cap to spread 429s. No production
 * dependencies — stdlib only (AbortSignal, Promise).
 */

/** Classify an HTTP status / thrown error into a terminal vs retryable bucket. */
export type FailureClass = "ok" | "rate_limited" | "server_error" | "timeout" | "client_error" | "network";

export function classifyStatus(status: number): FailureClass {
  if (status === 429) return "rate_limited";
  if (status >= 500 && status < 600) return "server_error";
  if (status >= 400 && status < 500) return "client_error";
  return "ok";
}

export function classifyError(error: unknown): FailureClass {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && /abort|timeout/i.test(error.name)) return "timeout";
  if (error instanceof TypeError) return "network"; // fetch network failure
  return "network";
}

/** Only rate-limited and server-error responses (and timeouts/network blips) are retried. */
export function isRetryable(cls: FailureClass): boolean {
  return cls === "rate_limited" || cls === "server_error" || cls === "timeout" || cls === "network";
}

/** Full-jitter sleep: uniform [0, min(cap, base * 2^(attempt-1))). */
export function jitterDelay(attempt: number, baseMs: number, capMs: number): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

export interface RetryOptions {
  /** Total attempts including the first (2 = one retry). Default 2. */
  attempts?: number;
  /** Base backoff in ms. Default 500. */
  baseMs?: number;
  /** Backoff cap in ms. Default 4000. */
  capMs?: number;
  /** Per-attempt timeout in ms (AbortSignal). Default 30000. */
  timeoutMs?: number;
  /** Optional sink to record the final attempt count + failure class. */
  onResult?: (info: { attempts: number; class: FailureClass; status?: number }) => void;
}

/**
 * Run an async fetch with a bounded retry budget and per-attempt timeout.
 *
 * The callback receives an AbortSignal that is aborted after `timeoutMs` so the
 * underlying fetch can cancel. Returns the Response on the first non-retryable
 * success; throws on terminal (client error / exhausted retries).
 */
export async function fetchWithRetry(
  run: (signal: AbortSignal, attempt: number) => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 2;
  const baseMs = opts.baseMs ?? 500;
  const capMs = opts.capMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let lastStatus: number | undefined;
  let lastClass: FailureClass = "network";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await run(controller.signal, attempt);
      clearTimeout(timer);
      lastStatus = res.status;
      lastClass = classifyStatus(res.status);
      if (lastClass === "ok" || !isRetryable(lastClass)) {
        opts.onResult?.({ attempts: attempt, class: lastClass, status: res.status });
        return res;
      }
      // retryable HTTP status — fall through to backoff
    } catch (error) {
      clearTimeout(timer);
      lastClass = classifyError(error);
      if (!isRetryable(lastClass) || attempt >= attempts) {
        opts.onResult?.({ attempts: attempt, class: lastClass });
        throw error;
      }
    }
    if (attempt < attempts) {
      const delay = jitterDelay(attempt, baseMs, capMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  opts.onResult?.({ attempts, class: lastClass, status: lastStatus });
  // Exhausted retries on a retryable status — return the last response so the
  // caller's existing non-200 handling (logs + fallback) runs unchanged.
  // For timeout/network we rethrow via the catch above; this path is HTTP-only.
  return new Response(null, { status: lastStatus ?? 503 });
}

/**
 * Bounded concurrency mapper — runs `fn` over `items` with at most `limit`
 * concurrent in-flight calls. Replaces unbounded `Promise.all` fan-out so a
 * large prompt/platform matrix cannot amplify into unbounded provider work.
 *
 * Preserves input order in the output array. Errors are caught per-item and
 * returned as the `error` field so one slow/bad provider cannot reject the
 * whole batch (callers already have per-item fallbacks).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const cap = Math.max(1, limit);
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        const value = await fn(items[idx]!, idx);
        results[idx] = { ok: true, value };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  }
  const workers = Array.from({ length: Math.min(cap, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
