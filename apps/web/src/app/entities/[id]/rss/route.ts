import { headers } from 'next/headers';

import { api } from '@/lib/api';
import { buildRssXml, signalExcerpt, signalHeadline } from '@/lib/rss';

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

  const xml = buildRssXml({
    title: `High Signal — ${entity.name}${entity.ticker ? ` (${entity.ticker})` : ''}`,
    link: `${base}/entities/${entity.id}`,
    description: `Every published High Signal signal tied to ${entity.name}. Evidence-backed, direction + confidence, scored against forward returns.`,
    lastBuildDate: signals.length > 0 ? new Date(signals[0].publishedAt) : new Date(),
    items: signals.map((s) => ({
      title: signalHeadline(s.bodyMd, s.slug),
      link: `${base}/signals/${s.slug}`,
      guid: `${base}/signals/${s.slug}`,
      pubDate: new Date(s.publishedAt),
      description: signalExcerpt(s.bodyMd, 600),
      categories: [s.signalType, s.direction, s.confidence, entity.id],
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
