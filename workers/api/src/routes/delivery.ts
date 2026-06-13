// Plan 0009 — Brief Distribution worker routes.
// /delivery/preferences (read/write user prefs)
// /delivery/test         (one-off test send)
// /delivery/log          (last 30 days for current user)
// /delivery/retry/:logId (manual retry)
// /delivery/internal/run (cron entry — gated by ADMIN_TOKEN)

import { Hono } from "hono";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  isKnownSkipReason,
  isValidWindow,
  nextRetryMinutes,
  resolveOpenWindow,
  type DeliveryChannel,
} from "@high-signal/shared";
import { db, schema } from "../db";
import { sendBriefEmail, type EmailEnv } from "../lib/email";
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

deliveryRoute.get("/preferences", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const rows = await db(c.env.DB)
    .select()
    .from(schema.deliveryPreferences)
    .where(eq(schema.deliveryPreferences.userId, userId));
  return c.json({ preferences: rows });
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
  if (!body.channel) return c.json({ error: "missing_channel" }, 400);
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
  await db(c.env.DB)
    .insert(schema.deliveryPreferences)
    .values({
      userId,
      channel: body.channel,
      email,
      rssToken: null,
      ...baseSet,
    })
    .onConflictDoUpdate({
      target: [schema.deliveryPreferences.userId, schema.deliveryPreferences.channel],
      set: email ? { ...baseSet, email } : baseSet,
    });
  return c.json({ ok: true });
});

deliveryRoute.get("/log", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
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
});

deliveryRoute.post("/test", async (c) => {
  const userId = userIdFromHeaders(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const email = emailFromHeaders(c);
  if (!email) return c.json({ error: "missing_email" }, 400);
  const env: EmailEnv = {
    SEND_EMAIL: c.env.SEND_EMAIL,
    EMAIL_FROM: c.env.EMAIL_FROM,
  };
  const result = await sendBriefEmail(env, {
    to: email,
    subject: `High Signal — test delivery`,
    briefDate: new Date().toISOString().slice(0, 10),
    region: "global",
    body: {
      sections: [
        {
          title: "Test send",
          items: [
            { text: "This is a one-off test from /settings/delivery.", links: [] },
          ],
        },
      ],
    },
  });
  return c.json(result);
});

// Cron / internal. Requires bearer to match ADMIN_TOKEN.
deliveryRoute.post("/internal/run", async (c) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return c.json({ error: "admin_disabled" }, 503);
  if (c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const dryRun = c.req.query("dry") === "1";
  const limit = Math.min(Number(c.req.query("limit") ?? 200), 1000);

  const prefs = await db(c.env.DB)
    .select()
    .from(schema.deliveryPreferences)
    .where(
      and(
        eq(schema.deliveryPreferences.enabled, true),
        eq(schema.deliveryPreferences.channel, "email"),
      ),
    )
    .limit(limit);

  const now = Date.now();
  const env: EmailEnv = {
    SEND_EMAIL: c.env.SEND_EMAIL,
    EMAIL_FROM: c.env.EMAIL_FROM,
  };
  const summary: Record<string, number> = {
    candidates: prefs.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    would_send: 0,
  };

  for (const p of prefs) {
    const open = resolveOpenWindow(
      { timezone: p.timezone, localWindowStart: p.localWindowStart },
      now,
    );
    if (!open) {
      await recordSkip(c.env.DB, p.userId, p.channel as DeliveryChannel, todayUtc(), "window_not_open");
      summary["skipped"]!++;
      continue;
    }
    if (!p.email) {
      await recordSkip(c.env.DB, p.userId, p.channel as DeliveryChannel, open.briefDate, "email_not_verified");
      summary["skipped"]!++;
      continue;
    }
    // Idempotency: the unique index drops duplicates; we still pre-check so
    // we count "already_sent" as skip rather than a noisy DB constraint error.
    const existing = await db(c.env.DB)
      .select({
        id: schema.deliveryLog.id,
        status: schema.deliveryLog.status,
        attempt: schema.deliveryLog.attempt,
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
      summary["skipped"]!++;
      continue;
    }
    // Respect retry backoff. nextRetryMinutes(attempt) === null means we've hit
    // the cap (default 3 attempts) and should stop retrying. The row stays at
    // failed; /admin/delivery surfaces it. Without this guard a stuck row gets
    // re-POSTed to the provider on every cron tick.
    if (prior && prior.status === "failed" && nextRetryMinutes(prior.attempt) === null) {
      summary["skipped"]!++;
      continue;
    }

    if (dryRun) {
      summary["would_send"] = (summary["would_send"] ?? 0) + 1;
      continue;
    }

    const briefRes = await composeBriefSnapshot(c.env, p.region, p.connectedBrandId);
    if (!briefRes) {
      await recordSkip(c.env.DB, p.userId, p.channel as DeliveryChannel, open.briefDate, "no_brief_today");
      summary["skipped"]!++;
      continue;
    }

    const result = await sendBriefEmail(env, {
      to: p.email,
      subject: `High Signal — ${open.briefDate} (${p.region})`,
      briefDate: open.briefDate,
      region: p.region,
      body: briefRes,
    });
    const newAttempt = prior
      ? prior.status === "failed"
        ? prior.attempt + 1
        : prior.attempt
      : 1;
    await db(c.env.DB)
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
          sentAt: result.ok ? new Date() : null,
        },
      });
    if (result.ok) summary["sent"]!++;
    else summary["failed"]!++;
  }

  return c.json(summary);
});

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

async function composeBriefSnapshot(
  env: Env,
  region: string,
  connectedBrandId: string | null,
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
  const url = `${env.API_BASE}/brief/daily?region=${encodeURIComponent(region)}${
    connectedBrandId ? `&product=${encodeURIComponent(connectedBrandId)}` : ""
  }`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const snapshot = (await r.json()) as {
      sections?: Array<{
        title: string;
        items?: Array<{ text?: string; claim?: string; sources?: string[] }>;
      }>;
    };
    return {
      sections: (snapshot.sections ?? []).map((s) => ({
        title: s.title,
        items: (s.items ?? []).map((i) => ({
          text: i.text ?? i.claim ?? "",
          links: i.sources ?? [],
        })),
      })),
    };
  } catch {
    return null;
  }
}
