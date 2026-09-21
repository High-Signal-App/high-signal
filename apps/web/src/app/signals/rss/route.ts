import { api } from '@/lib/api';
import { buildRssXml, signalExcerpt, signalHeadline } from '@/lib/rss';
import { isBackfillSignal, signalPresentation } from '@/lib/signal-format';
import { SITE_URL } from '@/lib/site';

export const revalidate = 300;

export async function GET() {
  const base = SITE_URL;

  let signals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  let degraded = false;
  try {
    const r = await api.signals();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* API offline — return an empty feed rather than 500, uncacheable. */
    degraded = true;
  }

  const xml = buildRssXml({
    title: 'High Signal — Signals',
    link: `${base}/signals`,
    description:
      'Every published High Signal signal — evidence-backed, with direction and confidence, scored against forward returns.',
    lastBuildDate: signals.length > 0 ? new Date(signals[0].publishedAt) : new Date(),
    items: signals.map((s) => ({
      title: signalPresentation(s).sample?.headline ?? signalHeadline(s.bodyMd, s.slug),
      link: `${base}/signals/${s.slug}`,
      guid: `${base}/signals/${s.slug}`,
      pubDate: new Date(s.publishedAt),
      description: signalPresentation(s).sample?.summary ?? signalExcerpt(s.bodyMd, 600),
      categories: signalPresentation(s).sample
        ? ['review sample', 'trend not established']
        : [s.signalType, s.direction, s.confidence],
    })),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': degraded
        ? 'no-store'
        : 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
