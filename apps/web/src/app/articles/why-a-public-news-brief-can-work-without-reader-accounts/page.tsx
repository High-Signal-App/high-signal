import { withAgentMetadata } from '@/lib/agent-page-metadata';
import type { Metadata } from 'next';

import { ArticlePage } from '@/components/content/ArticlePage';
import { articleBySlug } from '@/data/articles';
import { SITE_URL } from '@/lib/site';

const ARTICLE = articleBySlug('why-a-public-news-brief-can-work-without-reader-accounts');

export const dynamic = 'force-static';

export const metadata: Metadata = withAgentMetadata(
  {
    title: ARTICLE.metaTitle,
    description: ARTICLE.metaDescription,
    alternates: { canonical: `${SITE_URL}${ARTICLE.path}` },
  },
  '/articles/why-a-public-news-brief-can-work-without-reader-accounts'
);

export default function Page() {
  return <ArticlePage article={ARTICLE} />;
}
