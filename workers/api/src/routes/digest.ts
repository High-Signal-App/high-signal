import { Hono } from "hono";
import { and, desc, gte, eq, sql } from "drizzle-orm";
import { briefSnapshotToCompactDigest, type CompactBriefDigest } from "@high-signal/shared";
import { db, schema } from "../db";
import { fetchBriefSnapshot } from "../lib/brief-snapshot";

type Env = { DB: D1Database; API_BASE?: string };

export const digestRoute = new Hono<{ Bindings: Env }>();

digestRoute.get("/weekly", async (c) => {
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, "published"),
        gte(schema.signals.publishedAt, new Date(sinceMs)),
        sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`,
      ),
    )
    .orderBy(desc(schema.signals.publishedAt));
  return c.json({ since: new Date(sinceMs).toISOString(), signals: rows });
});

digestRoute.get("/rss", async (c) => {
  const token = c.req.query("token");
  if (token) {
    const compact = await loadPrivateDigest(c.env, token);
    if (compact === "unauthorized") return c.text("Invalid private feed token.", 401);
    if (!compact) return c.text("Daily brief unavailable.", 503);
    c.header("Content-Type", "application/rss+xml; charset=utf-8");
    c.header("Cache-Control", "private, no-store");
    return c.body(renderPrivateRss(compact));
  }

  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(eq(schema.signals.reviewStatus, "published"), sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`))
    .orderBy(desc(schema.signals.publishedAt))
    .limit(50);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>High Signal — AI infra signals</title>
<link>https://high-signal.dev</link>
<description>Public, evidence-backed signals for AI infra and semiconductors</description>
${rows
  .map(
    (s) => `<item>
  <title>${escapeXml((s.bodyMd ?? "").split("\n")[0].replace(/^#\s*/, ""))}</title>
  <link>https://high-signal.dev/signals/${s.slug}</link>
  <guid isPermaLink="false">${s.id}</guid>
  <pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate>
  <description>${escapeXml((s.bodyMd ?? "").slice(0, 400))}</description>
</item>`,
  )
  .join("\n")}
</channel></rss>`;
  c.header("Content-Type", "application/rss+xml; charset=utf-8");
  return c.body(xml);
});

digestRoute.get("/atom", async (c) => {
  const token = c.req.query("token");
  if (token) {
    const compact = await loadPrivateDigest(c.env, token);
    if (compact === "unauthorized") return c.text("Invalid private feed token.", 401);
    if (!compact) return c.text("Daily brief unavailable.", 503);
    c.header("Content-Type", "application/atom+xml; charset=utf-8");
    c.header("Cache-Control", "private, no-store");
    return c.body(renderPrivateAtom(compact));
  }

  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(and(eq(schema.signals.reviewStatus, "published"), sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`))
    .orderBy(desc(schema.signals.publishedAt))
    .limit(50);
  const updated = rows[0]?.publishedAt
    ? new Date(rows[0].publishedAt).toISOString()
    : new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>High Signal — AI infra signals</title>
  <id>https://high-signal.dev/digest/atom</id>
  <link rel="self" type="application/atom+xml" href="https://high-signal.dev/digest/atom" />
  <updated>${updated}</updated>
${rows
  .map(
    (signal) => `  <entry>
    <title>${escapeXml((signal.bodyMd ?? "").split("\n")[0].replace(/^#\s*/, ""))}</title>
    <id>${escapeXml(signal.id)}</id>
    <link href="https://high-signal.dev/signals/${escapeXml(signal.slug)}" />
    <updated>${new Date(signal.publishedAt).toISOString()}</updated>
    <summary>${escapeXml((signal.bodyMd ?? "").slice(0, 400))}</summary>
  </entry>`,
  )
  .join("\n")}
</feed>`;
  c.header("Content-Type", "application/atom+xml; charset=utf-8");
  return c.body(xml);
});

async function loadPrivateDigest(
  env: Env,
  token: string,
): Promise<CompactBriefDigest | "unauthorized" | null> {
  // Reject malformed values before touching D1; real tokens are 256-bit hex.
  if (!/^[0-9a-f]{64}$/.test(token)) return "unauthorized";
  const rows = await db(env.DB)
    .select({
      userId: schema.deliveryPreferences.userId,
      region: schema.deliveryPreferences.region,
      connectedBrandId: schema.deliveryPreferences.connectedBrandId,
    })
    .from(schema.deliveryPreferences)
    .where(
      and(
        eq(schema.deliveryPreferences.channel, "rss"),
        eq(schema.deliveryPreferences.enabled, true),
        eq(schema.deliveryPreferences.rssToken, token),
      ),
    )
    .limit(1);
  const preference = rows[0];
  if (!preference) return "unauthorized";
  const snapshot = await fetchBriefSnapshot(
    env,
    preference.region,
    preference.connectedBrandId,
    preference.userId,
  );
  return snapshot ? briefSnapshotToCompactDigest(snapshot) : null;
}

export function renderPrivateRss(digest: CompactBriefDigest): string {
  const items = digest.sections.flatMap((section) =>
    section.items.map((item, index) => {
      const link = item.evidenceUrls[0] ?? `https://highsignal.app/brief?region=${encodeURIComponent(digest.region)}`;
      const sources = item.evidenceUrls.length > 0
        ? `\n\nSources: ${item.evidenceUrls.join(" · ")}`
        : "";
      return `<item>
  <title>${escapeXml(`${section.title} — ${item.text}`)}</title>
  <link>${escapeXml(link)}</link>
  <guid isPermaLink="false">${escapeXml(`${digest.schema}:${digest.generatedAt}:${section.id}:${index}`)}</guid>
  <pubDate>${new Date(digest.generatedAt).toUTCString()}</pubDate>
  <description>${escapeXml(`${item.text}${sources}`)}</description>
</item>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escapeXml(`High Signal — Daily brief (${digest.region})`)}</title>
<link>https://highsignal.app/brief</link>
<description>Private, evidence-backed High Signal daily brief</description>
${items.join("\n")}
</channel></rss>`;
}

export function renderPrivateAtom(digest: CompactBriefDigest): string {
  const updated = new Date(digest.generatedAt).toISOString();
  const entries = digest.sections.flatMap((section) =>
    section.items.map((item, index) => {
      const id = `${digest.schema}:${digest.generatedAt}:${section.id}:${index}`;
      const link = item.evidenceUrls[0] ?? `https://highsignal.app/brief?region=${encodeURIComponent(digest.region)}`;
      const sources = item.evidenceUrls.length > 0
        ? `\n\nSources: ${item.evidenceUrls.join(" · ")}`
        : "";
      return `  <entry>
    <title>${escapeXml(`${section.title} — ${item.text}`)}</title>
    <id>${escapeXml(id)}</id>
    <link href="${escapeXml(link)}" />
    <updated>${updated}</updated>
    <summary>${escapeXml(`${item.text}${sources}`)}</summary>
  </entry>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(`High Signal — Daily brief (${digest.region})`)}</title>
  <id>${escapeXml(`urn:high-signal:daily:${digest.region}`)}</id>
  <updated>${updated}</updated>
${entries.join("\n")}
</feed>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
