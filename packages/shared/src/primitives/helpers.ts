// Small, dependency-free utilities shared across the web app, worker, and scripts.
// Consolidated here to remove verbatim copies that previously lived in
// apps/web/src/lib/{daily-intelligence,daily-range,market-watch}.ts and scripts/.

/** Hours elapsed since an ISO timestamp, rounded to 0.1h. Null for missing/invalid input. */
export function hoursSince(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const age = (now.getTime() - new Date(iso).getTime()) / 36e5;
  if (!Number.isFinite(age)) return null;
  return Math.max(0, Math.round(age * 10) / 10);
}

/** Tally value frequencies, returning `{ k, n }[]` sorted by count desc then key asc. */
export function countBy<T extends string>(values: T[]): { k: T; n: number }[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

/** Add `days` to a `YYYY-MM-DD` date string (UTC), returning a `YYYY-MM-DD` string. */
export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
