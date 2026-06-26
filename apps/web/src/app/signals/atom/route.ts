import { headers } from 'next/headers';

import { api } from '@/lib/api';
import { signalExcerpt, signalHeadline } from '@/lib/rss';
import { isBackfillSignal } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Atom 1.0 feed mirror of /signals/rss. Some readers prefer Atom —
 * the canonical IDs are stable URLs so cross-format dedup just works.
 */
export async function GET() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const base = `${proto}://${host}`;

  let signals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  try {
    const r = await api.signals();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* API offline */
  }

  const updated =
    signals.length > 0 ? new Date(signals[0].publishedAt).toISOString() : new Date().toISOString();

  const entries = signals
    .map(
      (s) => `  <entry>
    <title>${escapeXml(signalHeadline(s.bodyMd, s.slug))}</title>
    <id>${escapeXml(`${base}/signals/${s.slug}`)}</id>
    <link href="${escapeXml(`${base}/signals/${s.slug}`)}" />
    <updated>${new Date(s.publishedAt).toISOString()}</updated>
    <summary>${escapeXml(signalExcerpt(s.bodyMd, 600))}</summary>
    <category term="${escapeXml(s.signalType)}" />
    <category term="${escapeXml(s.direction)}" />
    <category term="${escapeXml(s.confidence)}" />
  </entry>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>High Signal — Signals</title>
  <id>${escapeXml(`${base}/signals/atom`)}</id>
  <link rel="self" type="application/atom+xml" href="${escapeXml(`${base}/signals/atom`)}" />
  <link rel="alternate" type="text/html" href="${escapeXml(`${base}/signals`)}" />
  <updated>${updated}</updated>
${entries}
</feed>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
