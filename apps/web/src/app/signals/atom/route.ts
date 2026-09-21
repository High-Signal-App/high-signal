import { api } from '@/lib/api';
import { signalExcerpt, signalHeadline } from '@/lib/rss';
import { isBackfillSignal, signalPresentation } from '@/lib/signal-format';
import { SITE_URL } from '@/lib/site';

export const revalidate = 300;

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
  const base = SITE_URL;

  let signals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  let degraded = false;
  try {
    const r = await api.signals();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* API offline — empty feed is returned but must not be cached. */
    degraded = true;
  }

  const updated =
    signals.length > 0 ? new Date(signals[0].publishedAt).toISOString() : new Date().toISOString();

  const entries = signals
    .map(
      (s) => `  <entry>
    <title>${escapeXml(signalPresentation(s).sample?.headline ?? signalHeadline(s.bodyMd, s.slug))}</title>
    <id>${escapeXml(`${base}/signals/${s.slug}`)}</id>
    <link href="${escapeXml(`${base}/signals/${s.slug}`)}" />
    <updated>${new Date(s.publishedAt).toISOString()}</updated>
    <summary>${escapeXml(signalPresentation(s).sample?.summary ?? signalExcerpt(s.bodyMd, 600))}</summary>
    <category term="${escapeXml(signalPresentation(s).sample ? 'review sample' : s.signalType)}" />
    <category term="${escapeXml(signalPresentation(s).sample ? 'trend not established' : s.direction)}" />
    <category term="${escapeXml(signalPresentation(s).sample ? 'unverified hypothesis' : s.confidence)}" />
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
      'Cache-Control': degraded
        ? 'no-store'
        : 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
