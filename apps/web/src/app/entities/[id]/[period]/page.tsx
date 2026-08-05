import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  BackLink,
  FeedList,
  PageShell,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { BreadcrumbJsonLd, EntityMonthJsonLd } from '@/components/seo/structured-data';
import { api, type SignalRow } from '@/lib/api';
import { signalHeadline } from '@/lib/signal-format';
import { SITE_URL } from '@/lib/site';
import { entityPeriodSignalFilters } from '../../../../../public-corpus-records.mjs';
import { evaluateCollection, robotsForVerdict } from '../../../../../public-corpus-policy.mjs';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; period: string }>;
}): Promise<Metadata> {
  const { id, period } = await params;
  const signalFilters = entityPeriodSignalFilters(id, period);
  if (!signalFilters) {
    return { title: 'Archive not found', robots: { index: false, follow: true } };
  }
  let childCount = 0;
  try {
    childCount = (await api.signals(signalFilters)).signals.length;
  } catch {
    /* Missing data fails closed to noindex. */
  }
  const verdict = evaluateCollection('entity-period', { childCount }, 2);
  return {
    title: `${id} signals — ${period} archive`,
    description: `Every published High Signal call on ${id} during ${period}, with citations and directional confidence inline.`,
    alternates: { canonical: `${SITE_URL}/entities/${id}/${period}` },
    robots: robotsForVerdict(verdict),
  };
}

export default async function EntityMonthPage({
  params,
}: {
  params: Promise<{ id: string; period: string }>;
}) {
  const { id, period } = await params;
  const signalFilters = entityPeriodSignalFilters(id, period);
  if (!signalFilters) notFound();

  let entity: { id: string; name: string; ticker: string | null } | null = null;
  let monthSignals: SignalRow[] = [];
  try {
    const [detail, periodSignals] = await Promise.all([api.entity(id), api.signals(signalFilters)]);
    entity = detail.entity;
    monthSignals = periodSignals.signals;
  } catch {
    /* api offline or entity missing */
  }
  if (!entity) notFound();

  const ups = monthSignals.filter((s) => s.direction === 'up').length;
  const downs = monthSignals.filter((s) => s.direction === 'down').length;
  const types = Array.from(new Set(monthSignals.map((s) => s.signalType)));
  const verdict = evaluateCollection('entity-period', { childCount: monthSignals.length }, 2);

  return (
    <PageShell>
      <BackLink href={`/entities/${id}`}>{`back to ${entity.name}`}</BackLink>
      <BreadcrumbJsonLd
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Entities', path: '/entities' },
          { name: entity.name, path: `/entities/${id}` },
          { name: period, path: `/entities/${id}/${period}` },
        ]}
      />
      {verdict.eligible && (
        <EntityMonthJsonLd
          entityName={entity.name}
          entityId={id}
          period={period}
          signalCount={monthSignals.length}
        />
      )}

      <SectionHeader
        eyebrow={`${entity.name}${entity.ticker ? ` · ${entity.ticker}` : ''} · archive`}
        title={`${period}`}
      >
        Every published High Signal call on <strong>{entity.name}</strong> during {period}. The
        archive is regenerated whenever a signal is added, edited, killed, or scored.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: 'signals this month',
            value: monthSignals.length.toString(),
            sub: 'published only',
          },
          { label: 'up calls', value: ups.toString(), sub: 'directional bullish' },
          { label: 'down calls', value: downs.toString(), sub: 'directional bearish' },
          {
            label: 'distinct types',
            value: types.length.toString(),
            sub: 'signal taxonomies seen',
          },
        ]}
      />

      <FeedList
        eyebrow={`signals — ${period}`}
        empty={`No published signals on ${entity.name} during ${period}.`}
        items={monthSignals.map((s) => ({
          href: `/signals/${s.slug}`,
          kicker: `${new Date(s.publishedAt).toISOString().slice(0, 10)} · ${s.signalType} · ${s.direction} · ${s.confidence}`,
          title: signalHeadline(s.bodyMd, s.slug),
          body: null,
        }))}
      />
    </PageShell>
  );
}
