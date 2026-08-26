const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const HISTORY_ACCESS_ACTION = 'history_access';
export const HISTORY_ACCESS_COOKIE = 'high-signal-history';
export const HISTORY_ACCESS_TTL_SECONDS = 12 * 60 * 60;

/** Return the operator-day key in Asia/Kolkata without depending on host locale data. */
export function istDay(now = new Date(), offsetDays = 0): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

/** UTC instants spanning one operator day in Asia/Kolkata. */
export function istDayRange(day: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00.000+05:30`);
  if (!Number.isFinite(start.getTime()) || istDay(start) !== day) return null;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Today and yesterday are public. Anything earlier requires a human-history grant. */
export function isProtectedHistoryDay(day: string, now = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < istDay(now, -1);
}

export function istDayFromTimestamp(value: number | string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return istDay(parsed);
}

export function recentHistoryStart(now = new Date()): Date {
  return new Date(`${istDay(now, -1)}T00:00:00.000+05:30`);
}
