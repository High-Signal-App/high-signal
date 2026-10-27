import { withAgentMetadata } from '@/lib/agent-page-metadata';
import type { Metadata } from 'next';
import { CurrentBriefPage } from '@/components/brief/CurrentBriefPage';
import { SITE_NAME, SITE_TWITTER, SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

const title = `${SITE_NAME} — Technology, startups and finance brief`;
const description =
  'Read the daily technology, startup and finance brief with attributed news, evidence-qualified signals, source links, uncertainties and permanent signal history.';

export const metadata: Metadata = withAgentMetadata(
  {
    title: { absolute: title },
    description,
    alternates: { canonical: `${SITE_URL}/` },
    openGraph: {
      type: 'website',
      url: SITE_URL,
      siteName: SITE_NAME,
      title,
      description,
      locale: 'en_US',
      images: [
        { url: '/opengraph-image', width: 1200, height: 630, alt: `${SITE_NAME} — Daily Brief` },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      creator: SITE_TWITTER,
      images: ['/opengraph-image'],
    },
  },
  '/'
);

export default function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string; day?: string; news_page?: string | string[] }>;
}) {
  return <CurrentBriefPage searchParams={searchParams} />;
}
