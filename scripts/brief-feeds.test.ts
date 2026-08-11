#!/usr/bin/env tsx

import {
  BRIEF_FEEDS,
  briefFeedDefinition,
  briefFeedItemKey,
  composeBriefFeedEdition,
  resolveBriefFeedPeriod,
  resolveFeedCadence,
  shiftBriefFeedPeriod,
  type BriefSnapshot,
} from '@high-signal/shared';
import assert from 'node:assert/strict';

let assertions = 0;
function equal<T>(actual: T, expected: T, label: string) {
  assert.equal(actual, expected, label);
  assertions++;
}
function deepEqual(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}

function present<T>(value: T | null | undefined, label: string): T {
  assert.ok(value, label);
  return value;
}

function snapshot(date: string, headline = `Signal ${date}`): BriefSnapshot {
  return {
    generatedAt: `${date}T07:00:00.000Z`,
    region: 'global',
    hasBrand: false,
    stocks: [
      {
        entityId: 'nvda',
        entityName: 'NVIDIA',
        ticker: 'NVDA',
        country: 'US',
        signalType: 'supply_chain',
        signalFamily: 'supply',
        direction: 'up',
        confidence: 'high',
        predictedWindowDays: 14,
        headline,
        signalSlug: 'nvidia-supply',
        publishedAt: '2026-08-10T06:00:00.000Z',
        evidenceUrls: [
          { url: 'https://www.sec.gov/Archives/example' },
          { url: 'https://www.reuters.com/technology/example' },
        ],
        hitRate: 0.75,
        hitRateSample: 4,
        hitRateBand: 'direct',
        whatChanged: 'NVIDIA changed its disclosed supply plan.',
        whyItMatters: 'The change affects near-term accelerator availability.',
        uncertainty: 'Supplier execution could still alter the timing.',
      },
      {
        entityId: 'old',
        entityName: 'Old Co',
        ticker: null,
        country: null,
        signalType: 'old_signal',
        signalFamily: 'other',
        direction: 'neutral',
        confidence: 'medium',
        predictedWindowDays: 30,
        headline: 'Old signal retained by the daily lookback',
        signalSlug: 'old-signal',
        publishedAt: '2026-07-01T00:00:00.000Z',
        evidenceUrls: [
          { url: 'https://www.sec.gov/Archives/old' },
          { url: 'https://www.reuters.com/technology/old' },
        ],
        hitRate: null,
        hitRateSample: 0,
        hitRateBand: 'none',
      },
    ],
    ideas: [
      {
        title: 'A workflow opening',
        description: 'Repeated setup complaints create a bounded product opening.',
        source: 'community',
        region: 'global',
        evidenceUrls: [{ url: 'https://www.reddit.com/r/startups/comments/abc?utm_source=x' }],
        subreddit: 'startups',
        surfacedAt: '2026-08-11T03:00:00.000Z',
        whyNow: 'The same constraint is now appearing across current discussions.',
      },
    ],
    trends: [],
    perception: [],
    improvements: [],
    categoryStates: {
      stocks: { status: 'ready', source: 'live' },
      ideas: { status: 'ready', source: 'live' },
      trends: { status: 'empty', source: 'live', reason: 'no_items' },
    },
  };
}

equal(BRIEF_FEEDS.length, 4, 'bounded feed count');
deepEqual(
  briefFeedDefinition('opportunity-radar').supportedCadences,
  ['weekly', 'monthly'],
  'opportunity cadence contract'
);
deepEqual(
  resolveFeedCadence(briefFeedDefinition('opportunity-radar'), 'daily'),
  { cadence: 'weekly', fellBack: true },
  'unsupported daily request falls back to weekly'
);
deepEqual(
  resolveFeedCadence(briefFeedDefinition('markets-companies'), 'monthly'),
  { cadence: 'monthly', fellBack: false },
  'supported cadence is retained'
);

const daily = present(
  resolveBriefFeedPeriod('daily', '2026-08-11', new Date('2026-08-11T12:00:00Z')),
  'daily period resolves'
);
deepEqual(
  [daily.key, daily.startsOn, daily.endsOn, daily.complete],
  ['2026-08-11', '2026-08-11', '2026-08-11', false],
  'daily boundary'
);
const weekly = present(
  resolveBriefFeedPeriod('weekly', '2026-W33', new Date('2026-08-11T12:00:00Z')),
  'weekly period resolves'
);
deepEqual(
  [weekly.startsOn, weekly.endsOn, weekly.complete],
  ['2026-08-10', '2026-08-16', false],
  'ISO week boundary'
);
const monthly = present(
  resolveBriefFeedPeriod('monthly', '2024-02', new Date('2026-08-11T12:00:00Z')),
  'monthly period resolves'
);
deepEqual(
  [monthly.startsOn, monthly.endsOn, monthly.complete],
  ['2024-02-01', '2024-02-29', true],
  'leap-month boundary'
);
equal(
  shiftBriefFeedPeriod(daily, -1).key,
  '2026-08-10',
  'daily navigation moves to the previous UTC date'
);
equal(shiftBriefFeedPeriod(weekly, -1).key, '2026-W32', 'weekly navigation crosses ISO periods');
equal(
  shiftBriefFeedPeriod(monthly, 1).key,
  '2024-03',
  'monthly navigation crosses calendar periods'
);
equal(resolveBriefFeedPeriod('daily', '2026-02-30'), null, 'invalid daily period rejected');
equal(resolveBriefFeedPeriod('weekly', '2026-W99'), null, 'invalid weekly period rejected');
equal(resolveBriefFeedPeriod('monthly', '2026-13'), null, 'invalid monthly period rejected');

const rows = [
  { date: '2026-08-10', snapshot: snapshot('2026-08-10', 'Earlier accepted copy') },
  { date: '2026-08-11', snapshot: snapshot('2026-08-11', 'Latest accepted copy') },
];
const edition = composeBriefFeedEdition({
  feed: briefFeedDefinition('brief'),
  requestedCadence: 'weekly',
  cadence: 'weekly',
  cadenceFellBack: false,
  period: weekly,
  region: 'global',
  rows,
});
equal(edition.snapshot.stocks.length, 1, 'weekly rollup removes duplicates and old lookback items');
equal(
  edition.snapshot.stocks[0]?.headline,
  'Latest accepted copy',
  'latest accepted representation wins'
);
equal(edition.snapshot.ideas.length, 1, 'repeated evidence identity is de-duplicated');
deepEqual(
  edition.contributingEditionDates,
  ['2026-08-10', '2026-08-11'],
  'daily provenance retained'
);
deepEqual(
  edition.itemEditionDates['stocks:nvidia-supply'],
  ['2026-08-10', '2026-08-11'],
  'duplicate contribution dates retained'
);
deepEqual(
  edition.coverage.contributingClasses,
  ['community', 'news', 'official'],
  'coverage derives from retained evidence'
);
equal(edition.coverage.uniqueEvidenceDomains, 3, 'coverage counts unique evidence domains');

const marketEdition = composeBriefFeedEdition({
  feed: briefFeedDefinition('markets-companies'),
  requestedCadence: 'weekly',
  cadence: 'weekly',
  cadenceFellBack: false,
  period: weekly,
  region: 'global',
  rows,
});
equal(marketEdition.snapshot.ideas.length, 0, 'focused market feed excludes opportunities');
equal(
  marketEdition.snapshot.categoryStates?.ideas.reason,
  'feed_excluded',
  'excluded state explicit'
);

const emptyEdition = composeBriefFeedEdition({
  feed: briefFeedDefinition('behavior-culture'),
  requestedCadence: 'weekly',
  cadence: 'weekly',
  cadenceFellBack: false,
  period: weekly,
  region: 'global',
  rows,
});
equal(
  emptyEdition.snapshot.categoryStates?.trends.status,
  'empty',
  'accepted sparse period is empty'
);

const unavailable = composeBriefFeedEdition({
  feed: briefFeedDefinition('brief'),
  requestedCadence: 'weekly',
  cadence: 'weekly',
  cadenceFellBack: false,
  period: weekly,
  region: 'global',
  rows: [],
});
equal(
  unavailable.snapshot.categoryStates?.stocks.status,
  'unavailable',
  'missing source period unavailable'
);

equal(
  briefFeedItemKey('ideas', present(snapshot('2026-08-11').ideas[0], 'snapshot idea exists')),
  'ideas:https://www.reddit.com/r/startups/comments/abc',
  'evidence identity strips query and trailing slash'
);

console.log(`brief feeds: ${assertions} assertions passed`);
