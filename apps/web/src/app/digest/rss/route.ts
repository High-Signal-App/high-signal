import { headers } from 'next/headers';

import { api, fetchApiResponse } from '@/lib/api';
import { buildRssXml, signalExcerpt, signalHeadline } from '@/lib/rss';
import { isBackfillSignal } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (token) {
    const response = await fetchApiResponse(`/digest/rss?token=${encodeURIComponent(token)}`);
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  }
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const base = `${proto}://${host}`;

  let signals: Awaited<ReturnType<typeof api.digestWeekly>>['signals'] = [];
  try {
    const r = await api.digestWeekly();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    // API offline — return an empty (but valid) feed so subscribers don't break.
  }

  const xml = buildRssXml({
    title: 'High Signal — Weekly digest',
    link: `${base}/digest`,
    description:
      'Evidence-backed signals from public and semi-public information streams. Weekly cohort.',
    lastBuildDate: signals.length > 0 ? new Date(signals[0].publishedAt) : new Date(),
    items: signals.map((s) => ({
      title: signalHeadline(s.bodyMd, s.slug),
      link: `${base}/signals/${s.slug}`,
      guid: `${base}/signals/${s.slug}`,
      pubDate: new Date(s.publishedAt),
      description: signalExcerpt(s.bodyMd, 600),
      categories: [s.signalType, s.direction, s.confidence],
    })),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
