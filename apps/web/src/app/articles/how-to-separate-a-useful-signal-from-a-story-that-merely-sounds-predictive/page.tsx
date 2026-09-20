import type { Metadata } from 'next';

import { ArticlePage } from '@/components/content/ArticlePage';
import { articleBySlug } from '@/data/articles';
import { SITE_URL } from '@/lib/site';

const ARTICLE = articleBySlug(
  'how-to-separate-a-useful-signal-from-a-story-that-merely-sounds-predictive'
);

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: ARTICLE.metaTitle,
  description: ARTICLE.metaDescription,
  alternates: { canonical: `${SITE_URL}${ARTICLE.path}` },
};

export default function Page() {
  return <ArticlePage article={ARTICLE} />;
}
