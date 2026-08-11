import type { Region } from '../primitives/region';
import type {
  BriefCategoryState,
  BriefIdeaItem,
  BriefPublicSectionKey,
  BriefSnapshot,
  BriefStockItem,
  BriefTrendItem,
} from './brief';
import { classifySource, sourceDomain, type SourceClass } from './signal-intelligence';

export const BRIEF_FEED_SLUGS = [
  'brief',
  'markets-companies',
  'opportunity-radar',
  'behavior-culture',
] as const;
export type BriefFeedSlug = (typeof BRIEF_FEED_SLUGS)[number];

export const BRIEF_FEED_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type BriefFeedCadence = (typeof BRIEF_FEED_CADENCES)[number];

export interface BriefFeedDefinition {
  slug: BriefFeedSlug;
  label: string;
  description: string;
  sections: BriefPublicSectionKey[];
  supportedCadences: BriefFeedCadence[];
  defaultCadence: BriefFeedCadence;
  slowerCadenceReason?: string;
  configuredSourceClasses: SourceClass[];
  materialGaps: string[];
}

export const BRIEF_FEEDS: readonly BriefFeedDefinition[] = [
  {
    slug: 'brief',
    label: 'The Brief',
    description: 'The strongest accepted markets, opportunity, and behavior items in one edition.',
    sections: ['stocks', 'ideas', 'trends'],
    supportedCadences: ['daily', 'weekly', 'monthly'],
    defaultCadence: 'daily',
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
  },
  {
    slug: 'markets-companies',
    label: 'Markets & Companies',
    description: 'Material company changes, market context, implications, and uncertainty.',
    sections: ['stocks'],
    supportedCadences: ['daily', 'weekly', 'monthly'],
    defaultCadence: 'daily',
    configuredSourceClasses: ['official', 'news', 'market', 'developer', 'regional', 'other'],
    materialGaps: [
      'premium broker research',
      'expert-call libraries',
      'real-time global earnings transcripts and slides',
    ],
  },
  {
    slug: 'opportunity-radar',
    label: 'Opportunity Radar',
    description:
      'Evidence-backed product openings after demand and competition have time to accumulate.',
    sections: ['ideas'],
    supportedCadences: ['weekly', 'monthly'],
    defaultCadence: 'weekly',
    slowerCadenceReason:
      'Published weekly so repeated demand and competition evidence can accumulate.',
    configuredSourceClasses: ['community', 'developer', 'review', 'news', 'regional', 'other'],
    materialGaps: ['restricted X and LinkedIn coverage', 'licensed social firehoses'],
  },
  {
    slug: 'behavior-culture',
    label: 'Behavior & Culture',
    description:
      'Changes in how people work, buy, and organize after weak signals begin to cohere.',
    sections: ['trends'],
    supportedCadences: ['weekly', 'monthly'],
    defaultCadence: 'weekly',
    slowerCadenceReason:
      'Published weekly because narrative and behavior shifts need more than one day.',
    configuredSourceClasses: ['community', 'review', 'news', 'regional', 'developer', 'other'],
    materialGaps: ['restricted X, LinkedIn, and TikTok coverage', 'licensed social firehoses'],
  },
] as const;

export function isBriefFeedSlug(value: string): value is BriefFeedSlug {
  return BRIEF_FEED_SLUGS.includes(value as BriefFeedSlug);
}

export function isBriefFeedCadence(value: string): value is BriefFeedCadence {
  return BRIEF_FEED_CADENCES.includes(value as BriefFeedCadence);
}

export function briefFeedDefinition(slug: BriefFeedSlug): BriefFeedDefinition {
  const definition = BRIEF_FEEDS.find((feed) => feed.slug === slug);
  if (!definition) throw new Error(`unknown brief feed: ${slug}`);
  return definition;
}

export function resolveFeedCadence(
  feed: BriefFeedDefinition,
  requested: string | null | undefined
): { cadence: BriefFeedCadence; fellBack: boolean } {
  if (requested && isBriefFeedCadence(requested) && feed.supportedCadences.includes(requested)) {
    return { cadence: requested, fellBack: false };
  }
  return { cadence: feed.defaultCadence, fellBack: Boolean(requested) };
}

export interface BriefFeedPeriod {
  cadence: BriefFeedCadence;
  key: string;
  startsOn: string;
  endsOn: string;
  complete: boolean;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function validDateKey(value: string): Date | null {
  const match = value.match(DATE_RE);
  if (!match) return null;
  const date = utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return dateKey(date) === value ? date : null;
}

function isoWeekParts(date: Date): { year: number; week: number; monday: Date } {
  const day = date.getUTCDay() || 7;
  const monday = addUtcDays(date, 1 - day);
  const thursday = addUtcDays(monday, 3);
  const year = thursday.getUTCFullYear();
  const jan4 = utcDate(year, 1, 4);
  const jan4Day = jan4.getUTCDay() || 7;
  const firstMonday = addUtcDays(jan4, 1 - jan4Day);
  const week = Math.floor((monday.getTime() - firstMonday.getTime()) / 604_800_000) + 1;
  return { year, week, monday };
}

function periodComplete(endsOn: string, now: Date) {
  return endsOn < dateKey(now);
}

function requiredPeriod(period: BriefFeedPeriod | null): BriefFeedPeriod {
  if (!period) throw new Error('internal brief period invariant failed');
  return period;
}

export function currentBriefFeedPeriod(
  cadence: BriefFeedCadence,
  now = new Date()
): BriefFeedPeriod {
  return requiredPeriod(resolveBriefFeedPeriod(cadence, undefined, now));
}

export function resolveBriefFeedPeriod(
  cadence: BriefFeedCadence,
  period?: string,
  now = new Date()
): BriefFeedPeriod | null {
  if (cadence === 'daily') {
    const selected = period ? validDateKey(period) : validDateKey(dateKey(now));
    if (!selected) return null;
    const key = dateKey(selected);
    return { cadence, key, startsOn: key, endsOn: key, complete: periodComplete(key, now) };
  }

  if (cadence === 'weekly') {
    let parts: { year: number; week: number; monday: Date };
    if (period) {
      const match = period.match(WEEK_RE);
      if (!match) return null;
      const year = Number(match[1]);
      const week = Number(match[2]);
      if (week < 1 || week > 53) return null;
      const jan4 = utcDate(year, 1, 4);
      const firstMonday = addUtcDays(jan4, 1 - (jan4.getUTCDay() || 7));
      const monday = addUtcDays(firstMonday, (week - 1) * 7);
      parts = isoWeekParts(monday);
      if (parts.year !== year || parts.week !== week) return null;
    } else {
      parts = isoWeekParts(now);
    }
    const startsOn = dateKey(parts.monday);
    const endsOn = dateKey(addUtcDays(parts.monday, 6));
    return {
      cadence,
      key: `${parts.year}-W${String(parts.week).padStart(2, '0')}`,
      startsOn,
      endsOn,
      complete: periodComplete(endsOn, now),
    };
  }

  const match = period?.match(MONTH_RE);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  if (month < 1 || month > 12) return null;
  const starts = utcDate(year, month, 1);
  const ends = new Date(Date.UTC(year, month, 0));
  const key = `${year}-${String(month).padStart(2, '0')}`;
  if (period && key !== period) return null;
  const endsOn = dateKey(ends);
  return {
    cadence,
    key,
    startsOn: dateKey(starts),
    endsOn,
    complete: periodComplete(endsOn, now),
  };
}

export function shiftBriefFeedPeriod(
  period: BriefFeedPeriod,
  offset: -1 | 1,
  now = new Date()
): BriefFeedPeriod {
  const starts = validDateKey(period.startsOn);
  if (!starts) throw new Error(`invalid brief period start: ${period.startsOn}`);
  if (period.cadence === 'daily') {
    return requiredPeriod(
      resolveBriefFeedPeriod('daily', dateKey(addUtcDays(starts, offset)), now)
    );
  }
  if (period.cadence === 'weekly') {
    const shifted = isoWeekParts(addUtcDays(starts, offset * 7));
    return requiredPeriod(
      resolveBriefFeedPeriod(
        'weekly',
        `${shifted.year}-W${String(shifted.week).padStart(2, '0')}`,
        now
      )
    );
  }
  const shifted = utcDate(starts.getUTCFullYear(), starts.getUTCMonth() + 1 + offset, 1);
  return requiredPeriod(resolveBriefFeedPeriod('monthly', dateKey(shifted).slice(0, 7), now));
}

export interface AcceptedBriefSnapshot {
  date: string;
  snapshot: BriefSnapshot;
}

export interface BriefFeedCoverageReceipt {
  configuredClasses: SourceClass[];
  contributingClasses: SourceClass[];
  uniqueEvidenceDomains: number;
  materialGaps: string[];
}

export interface BriefFeedEdition {
  feed: BriefFeedSlug;
  requestedCadence: string | null;
  cadence: BriefFeedCadence;
  cadenceFellBack: boolean;
  period: BriefFeedPeriod;
  region: Region;
  generatedAt: string;
  contributingEditionDates: string[];
  itemEditionDates: Record<string, string[]>;
  coverage: BriefFeedCoverageReceipt;
  snapshot: BriefSnapshot;
}

function normalizedUrl(value: string | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function briefFeedItemKey(
  section: BriefPublicSectionKey,
  item: BriefStockItem | BriefIdeaItem | BriefTrendItem
) {
  if (section === 'stocks') return `stocks:${(item as BriefStockItem).signalSlug}`;
  const evidence = normalizedUrl(item.evidenceUrls[0]?.url);
  if (evidence) return `${section}:${evidence}`;
  const surfacedAt = (item as BriefIdeaItem | BriefTrendItem).surfacedAt.slice(0, 10);
  return `${section}:${normalizedTitle((item as BriefIdeaItem | BriefTrendItem).title)}:${surfacedAt}`;
}

function itemDate(
  section: BriefPublicSectionKey,
  item: BriefStockItem | BriefIdeaItem | BriefTrendItem
) {
  return section === 'stocks'
    ? (item as BriefStockItem).publishedAt.slice(0, 10)
    : (item as BriefIdeaItem | BriefTrendItem).surfacedAt.slice(0, 10);
}

function inPeriod(value: string, period: BriefFeedPeriod) {
  return value >= period.startsOn && value <= period.endsOn;
}

function emptyState(reason: string): BriefCategoryState {
  return { status: 'empty', source: 'live', reason };
}

function rollupSection<T extends BriefStockItem | BriefIdeaItem | BriefTrendItem>(
  rows: AcceptedBriefSnapshot[],
  section: BriefPublicSectionKey,
  period: BriefFeedPeriod,
  itemEditionDates: Record<string, string[]>
): T[] {
  const selected = new Map<string, { item: T; editionDate: string }>();
  for (const row of rows) {
    const items = row.snapshot[section] as T[];
    for (const item of items) {
      if (period.cadence !== 'daily' && !inPeriod(itemDate(section, item), period)) continue;
      const key = briefFeedItemKey(section, item);
      const dates = itemEditionDates[key] ?? [];
      if (!dates.includes(row.date)) dates.push(row.date);
      itemEditionDates[key] = dates.sort();
      const previous = selected.get(key);
      if (!previous || row.date >= previous.editionDate)
        selected.set(key, { item, editionDate: row.date });
    }
  }
  return Array.from(selected.values())
    .sort((a, b) => itemDate(section, b.item).localeCompare(itemDate(section, a.item)))
    .map((entry) => entry.item);
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

export function composeBriefFeedEdition(input: {
  feed: BriefFeedDefinition;
  requestedCadence: string | null;
  cadence: BriefFeedCadence;
  cadenceFellBack: boolean;
  period: BriefFeedPeriod;
  region: Region;
  rows: AcceptedBriefSnapshot[];
  generatedAt?: string;
}): BriefFeedEdition {
  const rows = input.rows
    .filter((row) => row.date >= input.period.startsOn && row.date <= input.period.endsOn)
    .sort((a, b) => a.date.localeCompare(b.date));
  const itemEditionDates: Record<string, string[]> = {};
  const stocks = input.feed.sections.includes('stocks')
    ? rollupSection<BriefStockItem>(rows, 'stocks', input.period, itemEditionDates)
    : [];
  const ideas = input.feed.sections.includes('ideas')
    ? rollupSection<BriefIdeaItem>(rows, 'ideas', input.period, itemEditionDates)
    : [];
  const trends = input.feed.sections.includes('trends')
    ? rollupSection<BriefTrendItem>(rows, 'trends', input.period, itemEditionDates)
    : [];
  const contributingEditionDates = rows.map((row) => row.date);
  const noRows = rows.length === 0;
  const selectedState = (section: BriefPublicSectionKey, count: number): BriefCategoryState => {
    if (!input.feed.sections.includes(section)) return emptyState('feed_excluded');
    if (noRows) return { status: 'unavailable', source: 'live', reason: 'no_accepted_editions' };
    return count > 0 ? { status: 'ready', source: 'live' } : emptyState('no_period_items');
  };
  const snapshot: BriefSnapshot = {
    generatedAt: input.generatedAt ?? rows.at(-1)?.snapshot.generatedAt ?? new Date().toISOString(),
    region: input.region,
    hasBrand: false,
    stocks,
    ideas,
    trends,
    perception: [],
    improvements: [],
    categoryStates: {
      stocks: selectedState('stocks', stocks.length),
      ideas: selectedState('ideas', ideas.length),
      trends: selectedState('trends', trends.length),
    },
  };
  return {
    feed: input.feed.slug,
    requestedCadence: input.requestedCadence,
    cadence: input.cadence,
    cadenceFellBack: input.cadenceFellBack,
    period: input.period,
    region: input.region,
    generatedAt: snapshot.generatedAt,
    contributingEditionDates,
    itemEditionDates,
    coverage: coverageReceiptForSnapshot(input.feed, snapshot),
    snapshot,
  };
}
