import { withAgentMetadata } from '@/lib/agent-page-metadata';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { EntityDetail } from '@/components/organisms/EntityDetail';
import { StockDataClient } from '@/components/organisms/StockDataClient';
import { SITE_URL } from '@/lib/site';
import { evaluateEntity, robotsForVerdict } from '../../../../public-corpus-policy.mjs';

export const revalidate = 3600;

async function pageMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const base: Metadata = { alternates: { canonical: `${SITE_URL}/entities/${id}` } };
  try {
    const { entity, relationships, signals, marketQuotes = [] } = await api.entity(id);
    const label = entity.ticker ? `${entity.name} (${entity.ticker})` : entity.name;
    const verdict = evaluateEntity({
      signalCount: signals.length,
      relationshipCount: relationships.length,
      marketQuoteCount: marketQuotes.length,
    });
    return {
      ...base,
      title: `${label} — signals`,
      description: `Every published High Signal call tied to ${label}, with citations, directional confidence, and the spillover map of related entities.`,
      robots: robotsForVerdict(verdict),
    };
  } catch {
    return { ...base, title: `${id} — signals`, robots: { index: false, follow: true } };
  }
}

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof api.entity>>;
  try {
    data = await api.entity(id);
  } catch {
    return notFound();
  }

  return (
    <EntityDetail
      backHref="/entities"
      backLabel="entities"
      canonicalPath={`${SITE_URL}/entities/${id}`}
      data={data}
      stockData={data.entity.type === 'public' ? <StockDataClient company={id} /> : undefined}
    />
  );
}

export async function generateMetadata(props: Parameters<typeof pageMetadata>[0]) {
  const metadata = await pageMetadata(props);
  const params = await props.params;
  return withAgentMetadata(metadata, '/entities/' + encodeURIComponent(params['id']));
}
