import { headers } from 'next/headers';

import { api } from '@/lib/api';
import { buildRssXml, signalExcerpt, signalHeadline } from '@/lib/rss';
import { signalPresentation } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

/**
 * /entities/[id]/rss — RSS feed of every public signal tied to one entity.
 * Lets subscribers track a specific ticker / sector / company without
 * watching the firehose.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const base = `${proto}://${host}`;

  let entity: Awaited<ReturnType<typeof api.entity>>['entity'] | null = null;
  let signals: Awaited<ReturnType<typeof api.entity>>['signals'] = [];
  try {
    const r = await api.entity(id);
    entity = r.entity;
    signals = r.signals;
  } catch {
    return new Response('entity not found', { status: 404 });
  }

  if (!entity) return new Response('entity not found', { status: 404 });

  const items = signals.map((signal) => {
    const sample = signalPresentation(signal).sample;
    return {
      title: sample?.headline ?? signalHeadline(signal.bodyMd, signal.slug),
      link: `${base}/signals/${signal.slug}`,
      guid: `${base}/signals/${signal.slug}`,
      pubDate: new Date(signal.publishedAt),
      description: sample?.summary ?? signalExcerpt(signal.bodyMd, 600),
      categories: sample
        ? ['review sample', 'trend not established', entity.id]
        : [signal.signalType, signal.direction, signal.confidence, entity.id],
    };
  });

  const xml = buildRssXml({
    title: `High Signal — ${entity.name}${entity.ticker ? ` (${entity.ticker})` : ''}`,
    link: `${base}/entities/${entity.id}`,
    description: `Every published High Signal signal tied to ${entity.name}. Evidence-backed, direction + confidence, scored against forward returns.`,
    lastBuildDate: signals.length > 0 ? new Date(signals[0].publishedAt) : new Date(),
    items,
  });

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
