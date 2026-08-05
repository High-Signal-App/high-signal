import type { Metadata } from 'next';

import { IntelligenceGuidePage } from '@/components/content/IntelligenceGuidePage';
import { intelligenceGuide } from '@/data/intelligence-guides';
import { SITE_URL } from '@/lib/site';

const GUIDE = intelligenceGuide('daily-intelligence-brief');

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.metaDescription,
  alternates: { canonical: `${SITE_URL}${GUIDE.slug}` },
};

export default function DailyIntelligenceBriefPage() {
  return <IntelligenceGuidePage guide={GUIDE} />;
}
