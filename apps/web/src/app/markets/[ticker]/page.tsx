import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { EntityDetail } from '@/components/organisms/EntityDetail';
import { SITE_URL } from '@/lib/site';
import { evaluateEntity, robotsForVerdict } from '../../../../public-corpus-policy.mjs';

export const dynamic = 'force-dynamic';

const TICKER_REGEX = /^[A-Z0-9]+(?:\.[A-Z]+)?$/i;

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker: raw } = await params;
  const ticker = normalizeTicker(raw);
  const base: Metadata = { alternates: { canonical: `${SITE_URL}/markets/${ticker}` } };
  try {
    const { entities } = await api.entities();
    const entity = entities.find((e) => e.ticker?.toUpperCase() === ticker);
    if (!entity) return { ...base, title: `${ticker} — not found`, robots: { index: false } };
    const data = await api.entity(entity.id);
    const label = `${entity.name} (${ticker})`;
    const verdict = evaluateEntity({
      signalCount: data.signals.length,
      relationshipCount: data.relationships.length,
      marketQuoteCount: data.marketQuotes?.length ?? 0,
    });
    return {
      ...base,
      title: `${label} — signals and market context`,
      description: `Every published High Signal call for ${label}: price context, spillover map, prediction-market consensus, and cited signals.`,
      robots: robotsForVerdict(verdict),
    };
  } catch {
    return { ...base, title: `${ticker} — signals`, robots: { index: false, follow: true } };
  }
}

export default async function TickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = normalizeTicker(raw);
  if (!TICKER_REGEX.test(ticker)) return notFound();

  let entityId: string | null = null;
  try {
    const { entities } = await api.entities();
    const entity = entities.find((e) => e.ticker?.toUpperCase() === ticker);
    if (!entity) return notFound();
    entityId = entity.id;
  } catch {
    return notFound();
  }

  let data: Awaited<ReturnType<typeof api.entity>>;
  try {
    data = await api.entity(entityId);
  } catch {
    return notFound();
  }

  return (
    <EntityDetail
      backHref="/markets"
      backLabel="markets"
      canonicalPath={`${SITE_URL}/markets/${ticker}`}
      data={data}
    />
  );
}
