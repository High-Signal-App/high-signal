import type { Metadata } from 'next';
import { CurrentBriefPage } from '@/components/brief/CurrentBriefPage';
import { SITE_NAME, SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — Daily Brief` },
  description:
    'The current High Signal Daily Brief: evidence-backed market changes, business opportunities, and behavior shifts with permanent history.',
  alternates: { canonical: `${SITE_URL}/` },
};

export default function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string; day?: string }>;
}) {
  return <CurrentBriefPage searchParams={searchParams} />;
}
