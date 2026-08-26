import type { BriefSnapshot } from './brief';
import { classifySource, sourceDomain, type SourceClass } from './signal-intelligence';

export type BriefFeedSlug = 'brief';

export interface BriefFeedDefinition {
  slug: BriefFeedSlug;
  label: string;
  description: string;
  configuredSourceClasses: SourceClass[];
  materialGaps: string[];
}

const BRIEF_DEFINITION: BriefFeedDefinition = {
  slug: 'brief',
  label: 'Daily Brief',
  description: 'The strongest accepted markets, opportunity, and behavior items in one edition.',
  configuredSourceClasses: [
    'official',
    'news',
    'community',
    'market',
    'developer',
    'regional',
    'review',
    'other',
  ],
  materialGaps: ['premium research', 'expert-call libraries', 'restricted social firehoses'],
};

export function briefFeedDefinition(slug: BriefFeedSlug): BriefFeedDefinition {
  if (slug !== 'brief') throw new Error(`unknown brief feed: ${slug}`);
  return BRIEF_DEFINITION;
}

export interface BriefFeedCoverageReceipt {
  configuredClasses: SourceClass[];
  contributingClasses: SourceClass[];
  uniqueEvidenceDomains: number;
  materialGaps: string[];
}

export function coverageReceiptForSnapshot(
  feed: BriefFeedDefinition,
  snapshot: Pick<BriefSnapshot, 'stocks' | 'ideas' | 'trends'>
): BriefFeedCoverageReceipt {
  const urls = [...snapshot.stocks, ...snapshot.ideas, ...snapshot.trends].flatMap((item) =>
    item.evidenceUrls.map((citation) => citation.url).filter(Boolean)
  );
  const contributingClasses = Array.from(new Set(urls.map(classifySource))).sort();
  const domains = new Set(urls.map(sourceDomain).filter(Boolean));
  return {
    configuredClasses: [...feed.configuredSourceClasses],
    contributingClasses,
    uniqueEvidenceDomains: domains.size,
    materialGaps: [...feed.materialGaps],
  };
}
