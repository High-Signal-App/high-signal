// Plan 0009 — Brief Distribution helpers.
// Pure functions shared between the worker (composer + cron), tests, and
// the /settings/delivery UI for previewing local-window resolution.

export type DeliveryChannel = "email" | "rss" | "digest_json";
export type DeliveryStatus = "queued" | "sent" | "failed" | "skipped";
export type SkipReason =
  | "no_brief_today"
  | "preference_disabled"
  | "email_not_verified"
  | "bounced_recently"
  | "window_not_open"
  | "already_sent";

export interface DeliveryPreference {
  userId: string;
  channel: DeliveryChannel;
  enabled: boolean;
  email: string | null;
  region: string;
  timezone: string;
  localWindowStart: string; // HH:MM
  connectedBrandId: string | null;
  rssToken: string | null;
  updatedAt: string;
}

export interface DeliveryLogEntry {
  id: string;
  userId: string;
  channel: DeliveryChannel;
  briefDate: string; // YYYY-MM-DD
  status: DeliveryStatus;
  reason: SkipReason | string | null;
  providerMessageId: string | null;
  attempt: number;
  sentAt: string | null;
  createdAt: string;
}

// Time-window resolution. Workers can't trust Date.now() in some contexts
// (workflows resume cache); these helpers accept an explicit `now` so tests
// and reruns are deterministic.

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidWindow(start: string): boolean {
  return HHMM_RE.test(start);
}

// Resolve "is this user's local window currently open?" given a UTC now.
// Returns the brief_date (YYYY-MM-DD in user local tz) for the open window,
// or null if the window is closed. The window is treated as a one-hour open
// slot starting at `localWindowStart`.
export function resolveOpenWindow(
  pref: Pick<DeliveryPreference, "timezone" | "localWindowStart">,
  nowUtcMs: number,
): { briefDate: string } | null {
  if (!isValidWindow(pref.localWindowStart)) return null;
  const parts = partsInTimezone(new Date(nowUtcMs), pref.timezone);
  if (!parts) return null;
  const [h, m] = pref.localWindowStart.split(":").map((s) => Number(s));
  // Open from [H:M, H:M+60min). Close enough for hourly cron polling.
  const localMinutes = parts.hour * 60 + parts.minute;
  const windowStart = h! * 60 + m!;
  const windowEnd = windowStart + 60;
  if (localMinutes < windowStart || localMinutes >= windowEnd) return null;
  return { briefDate: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// Intl.DateTimeFormat works on the Workers runtime for any IANA tz that the
// runtime ships ICU data for ("UTC", "America/New_York", "Asia/Kolkata", etc).
// Returns null on an unknown tz.
function partsInTimezone(d: Date, tz: string): TzParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const map = new Map(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    const year = Number(map.get("year"));
    const month = Number(map.get("month"));
    const day = Number(map.get("day"));
    let hour = Number(map.get("hour"));
    if (hour === 24) hour = 0; // some runtimes emit 24:00 for midnight
    const minute = Number(map.get("minute"));
    if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
    return { year, month, day, hour, minute };
  } catch {
    return null;
  }
}

// Retry backoff classifier. Maps an attempt number → minutes to wait before
// the next retry. After `maxAttempts` we mark the row as terminal failed.
export function nextRetryMinutes(attempt: number, maxAttempts = 3): number | null {
  if (attempt >= maxAttempts) return null;
  if (attempt === 1) return 15;
  if (attempt === 2) return 60;
  return 240; // 4h
}

// Skip-reason taxonomy guard. The cron must always supply an explicit reason
// when status === 'skipped'; this helper validates the value at write time.
const KNOWN_SKIP_REASONS: SkipReason[] = [
  "no_brief_today",
  "preference_disabled",
  "email_not_verified",
  "bounced_recently",
  "window_not_open",
  "already_sent",
];
export function isKnownSkipReason(r: string): r is SkipReason {
  return (KNOWN_SKIP_REASONS as string[]).includes(r);
}

// Bounce policy. Three consecutive failed rows on the email channel auto-
// disable the preference; the next /settings visit shows the banner.
export function shouldAutoDisable(recentStatuses: DeliveryStatus[]): boolean {
  const last3 = recentStatuses.slice(-3);
  return last3.length === 3 && last3.every((s) => s === "failed");
}
