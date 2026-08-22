import { Hono } from 'hono';
import { and, desc, gte, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';

type Env = { DB: D1Database; API_BASE?: string };

export const digestRoute = new Hono<{ Bindings: Env }>();

digestRoute.get('/weekly', async (c) => {
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, 'published'),
        gte(schema.signals.publishedAt, new Date(sinceMs)),
        sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`
      )
    )
    .orderBy(desc(schema.signals.publishedAt));
  return c.json({ since: new Date(sinceMs).toISOString(), signals: rows });
});

digestRoute.get('/rss', async (c) => {
  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, 'published'),
        sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`
      )
    )
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
  <title>${escapeXml((s.bodyMd ?? '').split('\n')[0].replace(/^#\s*/, ''))}</title>
  <link>https://high-signal.dev/signals/${s.slug}</link>
  <guid isPermaLink="false">${s.id}</guid>
  <pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate>
  <description>${escapeXml((s.bodyMd ?? '').slice(0, 400))}</description>
</item>`
  )
  .join('\n')}
</channel></rss>`;
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  return c.body(xml);
});

digestRoute.get('/atom', async (c) => {
  const rows = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.reviewStatus, 'published'),
        sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`
      )
    )
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
    <title>${escapeXml((signal.bodyMd ?? '').split('\n')[0].replace(/^#\s*/, ''))}</title>
    <id>${escapeXml(signal.id)}</id>
    <link href="https://high-signal.dev/signals/${escapeXml(signal.slug)}" />
    <updated>${new Date(signal.publishedAt).toISOString()}</updated>
    <summary>${escapeXml((signal.bodyMd ?? '').slice(0, 400))}</summary>
  </entry>`
  )
  .join('\n')}
</feed>`;
  c.header('Content-Type', 'application/atom+xml; charset=utf-8');
  return c.body(xml);
});

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
