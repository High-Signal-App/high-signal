// Plan 0009 — Brief Distribution helpers.
// Pure functions shared between the worker (composer + cron), tests, and
// the /settings/delivery UI for previewing local-window resolution.

import type { BriefSnapshot } from "./brief";

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

/** Manual retries are an explicit email recovery path, never a way to replay
 * sent/skipped rows or future channel transports. */
export function canRetryDelivery(
  row: Pick<DeliveryLogEntry, "channel" | "status" | "attempt">,
): boolean {
  return row.channel === "email" && row.status === "failed" && row.attempt >= 1;
}

/** 256-bit bearer credential for a private RSS/Atom preference. */
export function createRssToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

// ─── Snapshot → email sections ──────────────────────────────────────────────
// /brief/daily returns a BriefSnapshot with five typed arrays (stocks / ideas /
// trends / perception / improvements) — NOT a generic `sections` list. This
// mapper flattens it into the channel-neutral shape the email renderer eats.
// Section titles mirror the web surface eyebrows so the email reads as the
// same product. Empty sections are dropped — an email never renders a bare
// header. Pure + deterministic so it's unit-testable outside the worker.

export interface EmailSectionItem {
  text: string;
  links: string[];
}

export interface EmailSection {
  title: string;
  items: EmailSectionItem[];
}

export interface CompactDigestItem {
  text: string;
  evidenceUrls: string[];
}

export interface CompactDigestSection {
  id: "stocks" | "ideas" | "trends" | "perception" | "improvements";
  title: string;
  items: CompactDigestItem[];
}

export interface CompactBriefDigest {
  schema: "high-signal.compact-digest.v1";
  generatedAt: string;
  region: string;
  sections: CompactDigestSection[];
}

const pctOf = (rate: number): string => `${Math.round(rate * 100)}%`;

function citationLinks(urls: Array<{ url: string }> | undefined): string[] {
  return (urls ?? []).map((c) => c.url).slice(0, 2);
}

export function briefSnapshotToEmailSections(
  snapshot: Partial<BriefSnapshot> | null | undefined,
): EmailSection[] {
  if (!snapshot) return [];
  const sections: EmailSection[] = [
    {
      title: "01 / stocks watching for a boom",
      items: (snapshot.stocks ?? []).map((s) => ({
        text: [
          `${s.entityName}${s.ticker ? ` (${s.ticker})` : ""} — ${s.headline}`,
          `${s.direction} · ${s.confidence} confidence`,
          s.hitRate != null
            ? `hit-rate ${pctOf(s.hitRate)} (${s.hitRateBand}, n=${s.hitRateSample})`
            : "no live calls yet",
        ].join(" · "),
        links: citationLinks(s.evidenceUrls),
      })),
    },
    {
      title: "02 / business ideas to build",
      items: (snapshot.ideas ?? []).map((i) => ({
        text: `${i.title} — ${i.description}${i.subreddit ? ` (r/${i.subreddit})` : ""}`,
        links: citationLinks(i.evidenceUrls),
      })),
    },
    {
      title: "03 / new lifestyle trends",
      items: (snapshot.trends ?? []).map((t) => ({
        text: `${t.title} — ${t.description} (r/${t.subreddit})`,
        links: citationLinks(t.evidenceUrls),
      })),
    },
    {
      title: "04 / how the market perceives your products",
      items: (snapshot.perception ?? []).map((p) => ({
        text: [
          `${p.brandName} — mention rate ${
            p.mentionRate != null ? pctOf(p.mentionRate) : "n/a"
          }, positive share ${p.positiveShare != null ? pctOf(p.positiveShare) : "n/a"}`,
          p.topIntent
            ? `${p.topIntent.intentStage} intent on ${p.topIntent.platform} (${p.topIntent.score}/100) · ${p.topIntent.actionType.replaceAll("_", " ")} · ${p.topIntent.sourceTitle}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        links: p.topIntent ? [p.topIntent.sourceUrl] : [],
      })),
    },
    {
      title: "05 / ideas to improve your products",
      items: (snapshot.improvements ?? []).map((im) => ({
        text: [
          `[${im.priority}] ${im.brandName} · ${im.area} — ${im.task}`,
          im.intent
            ? `${im.intent.intentStage} intent · ${im.intent.actionType.replaceAll("_", " ")} · ${im.intent.score}/100`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        links: im.sourceUrl ? [im.sourceUrl] : [],
      })),
    },
  ];
  return sections.filter((s) => s.items.length > 0);
}

const COMPACT_SECTION_IDS: CompactDigestSection["id"][] = [
  "stocks",
  "ideas",
  "trends",
  "perception",
  "improvements",
];

/** Channel-neutral, versioned daily-brief payload for private feeds and future
 * transports. It deliberately carries no delivery ids, email address, or user
 * id; the bearer/session boundary stays outside the content contract. */
export function briefSnapshotToCompactDigest(
  snapshot: Partial<BriefSnapshot>,
): CompactBriefDigest {
  const sections = briefSnapshotToEmailSections(snapshot).map((section) => {
    const ordinal = Number(section.title.slice(0, 2));
    const id = COMPACT_SECTION_IDS[ordinal - 1];
    if (!id) throw new Error(`unknown_brief_section:${section.title}`);
    return {
      id,
      title: section.title,
      items: section.items.map((item) => ({
        text: item.text,
        evidenceUrls: item.links,
      })),
    };
  });
  return {
    schema: "high-signal.compact-digest.v1",
    generatedAt: snapshot.generatedAt ?? "",
    region: snapshot.region ?? "global",
    sections,
  };
}

// ─── One-click unsubscribe token ────────────────────────────────────────────
// HMAC-SHA256(userId) under a server-side secret, truncated to 32 hex chars.
// Deterministic (no schema change needed) and unforgeable without the secret.
// The worker embeds `/delivery/unsubscribe?u=<userId>&t=<token>` in every
// brief email; the route recomputes and compares. Fail-closed: no secret →
// no link is embedded and the route refuses.
export async function unsubscribeToken(secret: string, userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`unsub:${userId}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
