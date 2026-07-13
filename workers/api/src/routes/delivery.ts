// Plan 0009 — Brief Distribution worker routes.
// /delivery/preferences (read/write user prefs)
// /delivery/test         (one-off test send)
// /delivery/log          (last 30 days for current user)
// /delivery/unsubscribe  (token-authenticated one-click opt-out)
// /delivery/internal/run (cron entry — gated by ADMIN_TOKEN; also invoked
//                         in-process by the worker's scheduled() handler)
//
// Fail-closed posture:
// - Email transport unconfigured (no SEND_EMAIL binding or no EMAIL_FROM) →
//   the run is a clean no-op with one log line; no delivery_log rows burn.
// - Delivery tables not yet migrated on this D1 (prod before
//   0010_brief_delivery.sql is applied) → every route degrades to a graceful
//   no-op with a clear log line instead of a 500.
// - No unsubscribe secret → no unsubscribe links are embedded and the
//   unsubscribe route refuses.

import { Hono } from "hono";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  briefSnapshotToCompactDigest,
  briefSnapshotToEmailSections,
  canRetryDelivery,
  createRssToken,
  isAutomaticRetryEligible,
  isKnownSkipReason,
  isValidWindow,
  nextRetryAtMs,
  resolveOpenWindow,
  shouldAutoDisable,
  unsubscribeToken,
  type DeliveryChannel,
} from "@high-signal/shared";
import { db, schema } from "../db";
import { emailTransportStatus, sendBriefEmail } from "../lib/email";
import { fetchBriefSnapshot } from "../lib/brief-snapshot";
import { sha16 } from "../lib/ids";

interface SendEmailBinding {
  send(message: unknown): Promise<void>;
}

type Env = {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  SEND_EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
  API_BASE?: string;
  /** HMAC secret for one-click unsubscribe tokens. Falls back to ADMIN_TOKEN. */
  DELIVERY_UNSUBSCRIBE_SECRET?: string;
};

export const deliveryRoute = new Hono<{ Bindings: Env }>();

// User identity for non-admin routes is taken from X-Clerk-User-Id, which the
// Next.js /api proxy injects after Clerk auth. Internal cron uses ADMIN_TOKEN.

function userIdFromHeaders(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header("X-Clerk-User-Id") ?? null;
}

function emailFromHeaders(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header("X-Admin-Email") ?? null;
}

// D1 throws `D1_ERROR: no such table: delivery_preferences` (message shape
// varies slightly by driver) when 0010_brief_delivery.sql has not been applied
// to this database yet. Treat that as "feature not flipped on", not a crash.
const MIGRATION_HINT =
  "[delivery] delivery tables missing — apply packages/db/migrations/0010_brief_delivery.sql (pnpm db:migrate:remote); treating as no-op";

function isMissingTableError(e: unknown): boolean {
  return /no such table/i.test(String(e instanceof Error ? e.message : e));
}

function unsubSecret(env: Env): string | null {
  return env.DELIVERY_UNSUBSCRIBE_SECRET ?? env.ADMIN_TOKEN ?? null;
}

deliveryRoute.get("/preferences", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  try {
    const rows = await db(c.env.DB)
      .select()
      .from(schema.deliveryPreferences)
      .where(eq(schema.deliveryPreferences.userId, userId));
    return c.json({ preferences: rows });
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return c.json({ preferences: [], pendingMigration: true });
    }
    throw e;
  }
});

deliveryRoute.post("/preferences", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json()) as {
    channel: DeliveryChannel;
    enabled?: boolean;
    region?: string;
    timezone?: string;
    localWindowStart?: string;
    connectedBrandId?: string | null;
  };
  if (!(["email", "rss", "digest_json"] as string[]).includes(body.channel)) {
    return c.json({ error: "bad_channel" }, 400);
  }
  if (body.localWindowStart && !isValidWindow(body.localWindowStart)) {
    return c.json({ error: "bad_window" }, 400);
  }
  const email = emailFromHeaders(c);
  const now = new Date();
  // Build the upsert set conditionally so a missing X-Admin-Email header does
  // not clobber a previously-persisted email (Clerk can transiently return an
  // empty primary email during OAuth races; the proxy then omits the header).
  const baseSet = {
    enabled: body.enabled ?? true,
    region: body.region ?? "global",
    timezone: body.timezone ?? "UTC",
    localWindowStart: body.localWindowStart ?? "07:00",
    connectedBrandId: body.connectedBrandId ?? null,
    updatedAt: now,
  };
  let rssToken: string | null = null;
  try {
    if (body.channel === "rss") {
      const existing = await db(c.env.DB)
        .select({ rssToken: schema.deliveryPreferences.rssToken })
        .from(schema.deliveryPreferences)
        .where(
          and(
            eq(schema.deliveryPreferences.userId, userId),
            eq(schema.deliveryPreferences.channel, "rss"),
          ),
        )
        .limit(1);
      rssToken = existing[0]?.rssToken ?? createRssToken();
    }
    await db(c.env.DB)
      .insert(schema.deliveryPreferences)
      .values({
        userId,
        channel: body.channel,
        email,
        rssToken,
        ...baseSet,
      })
      .onConflictDoUpdate({
        target: [schema.deliveryPreferences.userId, schema.deliveryPreferences.channel],
        set: {
          ...baseSet,
          ...(email ? { email } : {}),
          ...(body.channel === "rss" ? { rssToken } : {}),
        },
      });
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return c.json({ error: "pending_migration" }, 503);
    }
    throw e;
  }
  return c.json({ ok: true, ...(rssToken ? { rssToken } : {}) });
});

deliveryRoute.get("/log", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  try {
    const rows = await db(c.env.DB)
      .select()
      .from(schema.deliveryLog)
      .where(
        and(
          eq(schema.deliveryLog.userId, userId),
          gte(schema.deliveryLog.createdAt, since),
        ),
      )
      .orderBy(desc(schema.deliveryLog.createdAt))
      .limit(60);
    return c.json({ log: rows });
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return c.json({ log: [], pendingMigration: true });
    }
    throw e;
  }
});

deliveryRoute.post("/test", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const email = emailFromHeaders(c);
  if (!email) return c.json({ error: "missing_email" }, 400);
  const transport = emailTransportStatus(c.env);
  if (!transport.ready) {
    console.warn(`[delivery] test send refused — email transport unconfigured (${transport.reason})`);
    return c.json({ ok: false, reason: transport.reason }, 503);
  }
  // Prefer the user's saved region so the test matches the real daily send.
  let region = "global";
  try {
    const pref = await db(c.env.DB)
      .select({ region: schema.deliveryPreferences.region })
      .from(schema.deliveryPreferences)
      .where(
        and(
          eq(schema.deliveryPreferences.userId, userId),
          eq(schema.deliveryPreferences.channel, "email"),
        ),
      )
      .limit(1);
    if (pref[0]?.region) region = pref[0].region;
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
    console.warn(MIGRATION_HINT);
  }
  const composed = await composeBriefSnapshot(c.env, region, null, userId);
  const result = await sendBriefEmail(c.env, {
    to: email,
    subject: `High Signal — test delivery`,
    briefDate: new Date().toISOString().slice(0, 10),
    region,
    body: composed ?? {
      sections: [
        {
          title: "Test send",
          items: [
            {
              text: "This is a one-off test from /settings/delivery. (Live brief compose was unavailable — check API_BASE.)",
              links: [],
            },
          ],
        },
      ],
    },
    unsubscribeUrl: await buildUnsubscribeUrl(c.env, userId),
  });
  return c.json(result, result.ok ? 200 : 502);
});

// Signed-in compact representation for future delivery transports. Reading
// this representation is not a send attempt and never touches delivery_log.
deliveryRoute.get("/digest", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  try {
    const preferences = await db(c.env.DB)
      .select()
      .from(schema.deliveryPreferences)
      .where(eq(schema.deliveryPreferences.userId, userId));
    const preference =
      preferences.find((item) => item.channel === "digest_json") ??
      preferences.find((item) => item.channel === "email") ??
      preferences.find((item) => item.channel === "rss");
    if (!preference) return c.json({ error: "preference_missing" }, 404);
    const snapshot = await fetchBriefSnapshot(
      c.env,
      preference.region,
      preference.connectedBrandId,
      userId,
    );
    if (!snapshot) return c.json({ error: "brief_unavailable" }, 503);
    c.header("Cache-Control", "private, no-store");
    return c.json(briefSnapshotToCompactDigest(snapshot));
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return c.json({ error: "pending_migration" }, 503);
    }
    throw e;
  }
});

// Manual recovery for a failed row. Eligibility and ownership are checked
// before a conditional failed→queued claim, so concurrent clicks cannot both
// reach the provider. Unlike unattended cron retries, an explicit retry may
// exceed the automatic three-attempt cap.
deliveryRoute.post("/retry/:logId", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const transport = emailTransportStatus(c.env);
  if (!transport.ready) return c.json({ error: transport.reason }, 503);

  try {
    const rows = await db(c.env.DB)
      .select()
      .from(schema.deliveryLog)
      .where(
        and(
          eq(schema.deliveryLog.id, c.req.param("logId")),
          eq(schema.deliveryLog.userId, userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return c.json({ error: "delivery_not_found" }, 404);
    if (!canRetryDelivery({
      channel: row.channel as DeliveryChannel,
      status: row.status,
      attempt: row.attempt,
    })) {
      return c.json({ error: "delivery_not_retryable" }, 409);
    }

    const preferences = await db(c.env.DB)
      .select()
      .from(schema.deliveryPreferences)
      .where(
        and(
          eq(schema.deliveryPreferences.userId, userId),
          eq(schema.deliveryPreferences.channel, "email"),
        ),
      )
      .limit(1);
    const preference = preferences[0];
    if (!preference) return c.json({ error: "preference_missing" }, 409);
    if (!preference.enabled) return c.json({ error: "preference_disabled" }, 409);
    if (!preference.email) return c.json({ error: "email_not_verified" }, 409);

    const snapshot = await fetchBriefSnapshot(
      c.env,
      preference.region,
      preference.connectedBrandId,
      userId,
    );
    if (!snapshot) return c.json({ error: "brief_unavailable" }, 503);
    const sections = briefSnapshotToEmailSections(snapshot);
    if (sections.length === 0) return c.json({ error: "no_brief_today" }, 409);

    const claimed = await db(c.env.DB)
      .update(schema.deliveryLog)
      .set({ status: "queued", reason: null, nextAttemptAt: null })
      .where(
        and(
          eq(schema.deliveryLog.id, row.id),
          eq(schema.deliveryLog.userId, userId),
          eq(schema.deliveryLog.status, "failed"),
        ),
      )
      .run();
    if ((claimed.meta.changes ?? 0) !== 1) {
      return c.json({ error: "retry_already_claimed" }, 409);
    }

    const attempt = row.attempt + 1;
    let result: Awaited<ReturnType<typeof sendBriefEmail>>;
    try {
      result = await sendBriefEmail(c.env, {
        to: preference.email,
        subject: `High Signal — ${row.briefDate} (${preference.region})`,
        briefDate: row.briefDate,
        region: preference.region,
        body: { sections },
        unsubscribeUrl: await buildUnsubscribeUrl(c.env, userId),
      });
    } catch (error) {
      result = {
        ok: false,
        reason: error instanceof Error ? error.message : "send_failed",
      };
    }
    await db(c.env.DB)
      .update(schema.deliveryLog)
      .set({
        status: result.ok ? "sent" : "failed",
        reason: result.ok ? null : result.reason ?? "send_failed",
        providerMessageId: result.providerMessageId ?? null,
        attempt,
        nextAttemptAt: result.ok ? null : retryDate(attempt, Date.now()),
        sentAt: result.ok ? new Date() : null,
      })
      .where(
        and(
          eq(schema.deliveryLog.id, row.id),
          eq(schema.deliveryLog.userId, userId),
        ),
      );
    console.log(`[delivery] manual retry ${result.ok ? "sent" : "failed"}; attempt=${attempt}`);
    return c.json(
      {
        ok: result.ok,
        status: result.ok ? "sent" : "failed",
        attempt,
        ...(result.ok ? {} : { reason: result.reason ?? "send_failed" }),
      },
      result.ok ? 200 : 502,
    );
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return c.json({ error: "pending_migration" }, 503);
    }
    throw e;
  }
});

// One-click unsubscribe. Linked from every brief email footer and the
// List-Unsubscribe header (RFC 8058 POSTs here too). Token-authenticated —
// no Clerk session required, so it works from any mail client.
deliveryRoute.on(["GET", "POST"], "/unsubscribe", async (c) => {
  const secret = unsubSecret(c.env);
  if (!secret) {
    console.warn("[delivery] unsubscribe refused — no DELIVERY_UNSUBSCRIBE_SECRET/ADMIN_TOKEN set (fail closed)");
    return c.text("Unsubscribe is not available right now.", 503);
  }
  const userId = c.req.query("u");
  const token = c.req.query("t");
  if (!userId || !token) return c.text("Missing token.", 400);
  const expected = await unsubscribeToken(secret, userId);
  if (token !== expected) return c.text("Invalid token.", 403);
  try {
    await db(c.env.DB)
      .update(schema.deliveryPreferences)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.deliveryPreferences.userId, userId),
          eq(schema.deliveryPreferences.channel, "email"),
        ),
      );
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return c.text("Nothing to unsubscribe.", 200);
    }
    throw e;
  }
  return c.html(
    `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:48px;text-align:center"><p>You are unsubscribed from the High Signal daily brief.</p><p style="color:#666;font-size:12px">Re-enable any time at high-signal.app/settings/delivery.</p></body></html>`,
  );
});

// Cron / internal. Requires bearer to match ADMIN_TOKEN.
deliveryRoute.post("/internal/run", async (c) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return c.json({ error: "admin_disabled" }, 503);
  if (c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const summary = await runDeliveryWindow(c.env, {
    dryRun: c.req.query("dry") === "1",
    limit: Math.min(Number(c.req.query("limit") ?? 200), 1000),
  });
  return c.json(summary);
});

// The delivery sweep. Called by /delivery/internal/run and by the worker's
// scheduled() handler (every 30 min — at least one tick lands inside each
// user's 1-hour local window). Idempotent: the delivery_log unique index plus
// the pre-check below prevent double-sends on re-entry.
export async function runDeliveryWindow(
  env: Env,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<Record<string, number | string>> {
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? 200;

  // Fail closed BEFORE touching delivery_log: an unconfigured transport must
  // not burn per-user retry attempts or spam failure rows.
  const transport = emailTransportStatus(env);
  if (!transport.ready && !dryRun) {
    console.warn(`[delivery] email transport unconfigured (${transport.reason}); skipping run (fail closed)`);
    return { skipped_run: transport.reason };
  }

  let prefs;
  try {
    prefs = await db(env.DB)
      .select()
      .from(schema.deliveryPreferences)
      .where(
        and(
          eq(schema.deliveryPreferences.enabled, true),
          eq(schema.deliveryPreferences.channel, "email"),
        ),
      )
      .limit(limit);
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(MIGRATION_HINT);
      return { skipped_run: "tables_missing" };
    }
    throw e;
  }

  const now = Date.now();
  const summary: Record<string, number | string> = {
    candidates: prefs.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    would_send: 0,
    auto_disabled: 0,
  };
  const bump = (k: string) => {
    summary[k] = (Number(summary[k]) || 0) + 1;
  };

  for (const p of prefs) {
    const open = resolveOpenWindow(
      { timezone: p.timezone, localWindowStart: p.localWindowStart },
      now,
    );
    if (!open) {
      await recordSkip(env.DB, p.userId, p.channel as DeliveryChannel, todayUtc(), "window_not_open");
      bump("skipped");
      continue;
    }
    if (!p.email) {
      await recordSkip(env.DB, p.userId, p.channel as DeliveryChannel, open.briefDate, "email_not_verified");
      bump("skipped");
      continue;
    }
    // Idempotency: the unique index drops duplicates; we still pre-check so
    // we count "already_sent" as skip rather than a noisy DB constraint error.
    const existing = await db(env.DB)
      .select({
        id: schema.deliveryLog.id,
        status: schema.deliveryLog.status,
        attempt: schema.deliveryLog.attempt,
        nextAttemptAt: schema.deliveryLog.nextAttemptAt,
      })
      .from(schema.deliveryLog)
      .where(
        and(
          eq(schema.deliveryLog.userId, p.userId),
          eq(schema.deliveryLog.channel, p.channel),
          eq(schema.deliveryLog.briefDate, open.briefDate),
        ),
      )
      .limit(1);
    const prior = existing[0];
    if (prior && prior.status === "sent") {
      bump("skipped");
      continue;
    }
    // Respect the persisted 15m / 1h / 4h retry schedule. A null schedule on
    // legacy rows remains immediately eligible below the cap; attempt 4 is
    // terminal. Without this guard a stuck row is retried every cron tick.
    if (
      prior &&
      prior.status === "failed" &&
      !isAutomaticRetryEligible(
        prior.attempt,
        prior.nextAttemptAt?.getTime() ?? null,
        now,
      )
    ) {
      bump("skipped");
      continue;
    }

    if (dryRun) {
      bump("would_send");
      continue;
    }

    const briefRes = await composeBriefSnapshot(env, p.region, p.connectedBrandId, p.userId);
    if (!briefRes) {
      await recordSkip(env.DB, p.userId, p.channel as DeliveryChannel, open.briefDate, "no_brief_today");
      bump("skipped");
      continue;
    }

    const result = await sendBriefEmail(env, {
      to: p.email,
      subject: `High Signal — ${open.briefDate} (${p.region})`,
      briefDate: open.briefDate,
      region: p.region,
      body: briefRes,
      unsubscribeUrl: await buildUnsubscribeUrl(env, p.userId),
    });
    const newAttempt = prior
      ? prior.status === "failed"
        ? prior.attempt + 1
        : prior.attempt
      : 1;
    const attemptedAtMs = Date.now();
    const nextAttemptAt = result.ok ? null : retryDate(newAttempt, attemptedAtMs);
    await db(env.DB)
      .insert(schema.deliveryLog)
      .values({
        id: await sha16(`delivery:${p.userId}:${p.channel}:${open.briefDate}`),
        userId: p.userId,
        channel: p.channel,
        briefDate: open.briefDate,
        status: result.ok ? "sent" : "failed",
        reason: result.ok ? null : result.reason ?? "send_failed",
        providerMessageId: result.providerMessageId ?? null,
        attempt: newAttempt,
        nextAttemptAt,
        sentAt: result.ok ? new Date() : null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.deliveryLog.id,
        set: {
          status: result.ok ? "sent" : "failed",
          reason: result.ok ? null : result.reason ?? "send_failed",
          providerMessageId: result.providerMessageId ?? null,
          attempt: newAttempt,
          nextAttemptAt,
          sentAt: result.ok ? new Date() : null,
        },
      });
    if (result.ok) {
      bump("sent");
    } else {
      bump("failed");
      // Bounce policy: three consecutive failed days auto-disable the channel
      // so we stop mailing a dead address. Reversible from /settings/delivery.
      if (await hasThreeConsecutiveFailures(env.DB, p.userId, p.channel)) {
        await db(env.DB)
          .update(schema.deliveryPreferences)
          .set({ enabled: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.deliveryPreferences.userId, p.userId),
              eq(schema.deliveryPreferences.channel, p.channel),
            ),
          );
        console.warn(`[delivery] auto-disabled email channel for ${p.userId} after 3 consecutive failures`);
        bump("auto_disabled");
      }
    }
  }

  return summary;
}

async function hasThreeConsecutiveFailures(
  d1: D1Database,
  userId: string,
  channel: string,
): Promise<boolean> {
  const recent = await db(d1)
    .select({ status: schema.deliveryLog.status })
    .from(schema.deliveryLog)
    .where(
      and(
        eq(schema.deliveryLog.userId, userId),
        eq(schema.deliveryLog.channel, channel),
      ),
    )
    .orderBy(desc(schema.deliveryLog.briefDate))
    .limit(3);
  // Rows come newest-first; shouldAutoDisable expects oldest-first.
  return shouldAutoDisable(recent.map((r) => r.status as "failed" | "sent" | "skipped" | "queued").reverse());
}

async function buildUnsubscribeUrl(env: Env, userId: string): Promise<string | undefined> {
  const secret = unsubSecret(env);
  // Fail closed: without a secret (or a public base to link back to) we embed
  // no unsubscribe link rather than a forgeable one. The footer still carries
  // the /settings/delivery management link.
  if (!secret || !env.API_BASE) return undefined;
  const token = await unsubscribeToken(secret, userId);
  return `${env.API_BASE}/delivery/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
}

async function recordSkip(
  d1: D1Database,
  userId: string,
  channel: DeliveryChannel,
  briefDate: string,
  reason: string,
) {
  if (!isKnownSkipReason(reason)) {
    // Force into the taxonomy at write time — never let a free-form reason slip in.
    reason = "no_brief_today";
  }
  await db(d1)
    .insert(schema.deliveryLog)
    .values({
      id: await sha16(`delivery:${userId}:${channel}:${briefDate}`),
      userId,
      channel,
      briefDate,
      status: "skipped",
      reason,
      providerMessageId: null,
      attempt: 1,
      sentAt: null,
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        schema.deliveryLog.userId,
        schema.deliveryLog.channel,
        schema.deliveryLog.briefDate,
      ],
    });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function retryDate(attempt: number, failedAtMs: number): Date | null {
  const retryAtMs = nextRetryAtMs(attempt, failedAtMs);
  return retryAtMs == null ? null : new Date(retryAtMs);
}

async function composeBriefSnapshot(
  env: Env,
  region: string,
  connectedBrandId: string | null,
  ownerId?: string,
): Promise<{
  sections: Array<{ title: string; items: Array<{ text: string; links: string[] }> }>;
} | null> {
  // Reuse /brief/daily — same composer the web surface uses. We talk to it
  // over HTTP via the public route so the worker stays single-binding.
  // API_BASE must be configured; otherwise a relative URL fails fast.
  if (!env.API_BASE) {
    console.error("[delivery] composeBriefSnapshot called without API_BASE; cron will skip every user");
    return null;
  }
  const snapshot = await fetchBriefSnapshot(env, region, connectedBrandId, ownerId);
  if (!snapshot) return null;
  const sections = briefSnapshotToEmailSections(snapshot);
  if (sections.length === 0) return null;
  return { sections };
}
