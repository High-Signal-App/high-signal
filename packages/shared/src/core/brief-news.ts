/**
 * News-first Daily Brief: select, group, rank, and summarize retained records.
 * Independent of cite-or-kill market-signal gates. Never invents copy.
 */

import { canonicalSourceUrl } from './source-document';
import { istDayRange } from './history-access';
import { classifySource, isPredictionMarketOnly, sourceDomain } from './signal-intelligence';
import type { BriefCitation, BriefNewsEvidenceStatus, BriefNewsItem } from './brief';
import type { Region } from '../primitives/region';

const NEWS_PAGE_SIZE = 20;
const DEFAULT_NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
const JACCARD_THRESHOLD = 0.72;
const TITLE_ONLY_MAX = 80;
const SUMMARY_MAX_SENTENCES = 3;
const EXCERPT_MAX = 30_000;
const RETAINED_BLOCKER_SCAN_MAX = 1_200;

export function paginateBriefNews({
  news,
  requestedPage,
}: {
  news: readonly BriefNewsItem[];
  requestedPage?: unknown;
}) {
  const pageCount = Math.max(1, Math.ceil(news.length / NEWS_PAGE_SIZE));
  const requested =
    typeof requestedPage === 'string' && /^[1-9]\d*$/.test(requestedPage)
      ? Number(requestedPage)
      : 1;
  const page = Number.isSafeInteger(requested) ? Math.min(requested, pageCount) : 1;
  const offset = (page - 1) * NEWS_PAGE_SIZE;
  return {
    items: news.slice(offset, offset + NEWS_PAGE_SIZE),
    page,
    pageCount,
    total: news.length,
    from: news.length ? offset + 1 : 0,
    to: Math.min(offset + NEWS_PAGE_SIZE, news.length),
  };
}

export function briefNewsPageHref({
  page,
  region,
  day,
  all = false,
}: {
  page: number;
  region: Region;
  day: 'today' | 'yesterday';
  all?: boolean;
}): string {
  const query = new URLSearchParams({
    ...(region === 'global' ? {} : { region }),
    ...(day === 'yesterday' ? { day } : {}),
    ...(page > 1 || all ? { news_page: String(page) } : {}),
  });
  return `${query.size ? `/?${query}` : '/'}#news`;
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'cmpid',
  'igshid',
  'spm',
  '_hsenc',
  '_hsmi',
]);

const STOP = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'for',
  'and',
  'or',
  'in',
  'on',
  'with',
  'at',
  'by',
  'is',
  'are',
  'new',
  'how',
  'why',
  'what',
  'from',
  'this',
  'that',
  'its',
  'has',
  'have',
  'will',
  'after',
  'over',
  'into',
]);

const EVENT_TOKENS = new Set([
  'acquire',
  'acquired',
  'acquires',
  'acquisition',
  'approval',
  'approves',
  'approved',
  'ban',
  'banned',
  'breach',
  'buy',
  'buys',
  'closes',
  'closed',
  'cuts',
  'deal',
  'earnings',
  'guidance',
  'incident',
  'ipo',
  'launches',
  'launched',
  'lawsuit',
  'lays',
  'layoff',
  'layoffs',
  'merger',
  'outage',
  'raises',
  'recall',
  'recalls',
  'release',
  'releases',
  'released',
  'resigns',
  'settles',
  'settlement',
  'ships',
  'shutdown',
  'sues',
  'wins',
]);

const COMPANYISH_STOP = new Set([
  ...STOP,
  'confirmed',
  'confirms',
  'customer',
  'customers',
  'data',
  'inc',
  'corp',
  'ltd',
  'llc',
  'plc',
  'group',
  'company',
  'co',
  'holdings',
]);

const ATTENTION_SOURCE_FAMILIES = new Set([
  'bluesky',
  'digg',
  'hackernews',
  'lobsters',
  'mts',
  'producthunt',
  'reddit',
]);

const BRIEF_NEWS_TOPICS = new Set([
  'acquire',
  'acquired',
  'acquires',
  'acquisition',
  'ai',
  'android',
  'antitrust',
  'api',
  'app',
  'apps',
  'automation',
  'bank',
  'banking',
  'battery',
  'billing',
  'breach',
  'capex',
  'chip',
  'chips',
  'cloud',
  'computing',
  'cybersecurity',
  'data',
  'deal',
  'developer',
  'developers',
  'digital',
  'earnings',
  'economic',
  'economy',
  'energy',
  'exports',
  'factory',
  'finance',
  'financial',
  'foundry',
  'funding',
  'gas',
  'hardware',
  'infrastructure',
  'internet',
  'investment',
  'investor',
  'iphone',
  'ipo',
  'launch',
  'launched',
  'launches',
  'lawsuit',
  'llm',
  'manufacturing',
  'market',
  'markets',
  'merger',
  'model',
  'models',
  'oil',
  'outage',
  'phone',
  'platform',
  'privacy',
  'product',
  'production',
  'profit',
  'purchase',
  'raises',
  'rates',
  'regulation',
  'regulator',
  'revenue',
  'robot',
  'robotics',
  'security',
  'semiconductor',
  'shares',
  'smartphone',
  'software',
  'solar',
  'startup',
  'stock',
  'supply',
  'tariff',
  'tech',
  'technology',
  'telecom',
  'trade',
  'transmission',
  'venture',
]);

const RETAINED_TEXT_BLOCKERS = [
  'please log in',
  'please login',
  'sign in to continue',
  'keep me signed in',
  'subscribe to read',
  'subscription required',
  'create an account to continue',
  'this content is for subscribers',
  'user id and password',
  'paywall',
  'search fieldhome page',
];

const ROUTINE_IR_SNAPSHOT_RE = /\bir snapshot$/i;
const ROUTINE_EARNINGS_CALENDAR_RE =
  /\bto (?:report|release|announce)\b.*\b(?:results|earnings|guidance)\b|\b(?:schedules?|announces?)\b.*\b(?:earnings|results)\s+(?:call|conference|date)\b|\bto (?:host|hold|webcast)\b.*\b(?:conference|earnings|results)\s+call\b|\b(?:results|earnings)\s+(?:\d{4}\s+)?date\s*(?:&(?:amp;)?|and)\s*time\b|\b(?:earnings|results)\s+(?:preview|announcement\s+schedule)\b/i;
const LOW_VALUE_NEWS_TITLE_RE =
  /^(?:court opinion:)\s|\b(?:top stocks?|stocks?) to buy\b|\btarget,?\s+stop-loss\b|\bshare price target\b|\bshould investors (?:buy|sell)\b|\b(?:sensex|nifty|stock market) prediction\b/i;

const SOURCE_RANK: Record<string, number> = {
  edgar: 9,
  'sec-xbrl': 9,
  ir: 9,
  hkex: 9,
  courtlistener: 8,
  legistar: 8,
  openstates: 8,
  regulations: 8,
  gov: 8,
  'gov-contracts': 8,
  'cisa-kev': 7,
  eia: 7,
  news: 6,
  guardian: 6,
  techmeme: 6,
  gdelt: 5,
};

const PREFIX_RE = /^([A-Za-z .]+(\[[^\]]*\])?\s*[—:]\s*)+/;
const LINK_RE = /Link:\s*(https?:\/\/\S+)/i;

export interface NewsRecord {
  id: string;
  source: string;
  sourceUrl: string;
  publishedAt: Date | number | string;
  ingestedAt: Date | number | string;
  title: string | null;
  content: string | null;
  retainedText: string | null;
  primaryEntityId?: string | null;
}

interface NewsReportingWindow {
  start: Date;
  end: Date;
  previousSnapshotAt: Date | null;
}

export function reportingWindow(
  previousSnapshotAt: Date | string | null | undefined,
  now = new Date()
): NewsReportingWindow {
  const end = now;
  if (previousSnapshotAt) {
    const start = toDate(previousSnapshotAt);
    if (Number.isFinite(start.getTime()) && start.getTime() < end.getTime()) {
      return { start, end, previousSnapshotAt: start };
    }
  }
  return {
    start: new Date(end.getTime() - DEFAULT_NEWS_WINDOW_MS),
    end,
    previousSnapshotAt: null,
  };
}

/**
 * Bound a news read to its requested IST edition. Current editions grow until
 * now; past editions stop at midnight so a repair read cannot pull in the next
 * day's records.
 */
export function reportingWindowForEdition(
  previousSnapshotAt: Date | string | null | undefined,
  editionDate: string,
  now = new Date()
): NewsReportingWindow {
  const edition = istDayRange(editionDate);
  if (!edition) return reportingWindow(previousSnapshotAt, now);
  if (now.getTime() < edition.start.getTime()) {
    return { start: edition.start, end: edition.start, previousSnapshotAt: null };
  }
  const end = now.getTime() < edition.end.getTime() ? now : edition.end;
  return reportingWindow(previousSnapshotAt, end);
}

export function selectNewsRecords(
  records: readonly NewsRecord[],
  window: NewsReportingWindow
): NewsRecord[] {
  const inWindow = (value: Date) =>
    value.getTime() >= window.start.getTime() && value.getTime() < window.end.getTime();

  const selected: NewsRecord[] = [];
  for (const members of clusterNewsRecords(records.filter(hasBriefNewsTopic))) {
    const fresh = members.filter((record) => inWindow(toDate(record.ingestedAt)));
    if (fresh.length === 0) continue;
    const older = members.filter(
      (record) => toDate(record.ingestedAt).getTime() < window.start.getTime()
    );
    if (older.length === 0) {
      selected.push(...fresh.filter(hasUsableRetainedText));
      continue;
    }
    const priorUrls = new Set(older.map((record) => newsCanonicalUrl(record)).filter(Boolean));
    const newEvidence = fresh.some((record) => {
      const url = newsCanonicalUrl(record);
      return url ? !priorUrls.has(url) : true;
    });
    if (!newEvidence) continue;
    selected.push(...members.filter(hasUsableRetainedText));
  }
  return selected;
}

/** Keep the reader feed inside the product's technology/startup/finance scope. */
export function hasBriefNewsTopic(record: NewsRecord): boolean {
  if (record.source.startsWith('market:') || isPredictionMarketOnly([record.sourceUrl])) {
    return false;
  }
  if (record.primaryEntityId?.trim()) return true;
  if ((SOURCE_RANK[sourceFamily(record.source)] ?? 0) >= 7) return true;
  const text = `${record.title ?? ''} ${retainedBody(record) ?? ''}`.slice(0, 800).toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  return tokens.some((token) => BRIEF_NEWS_TOPICS.has(token));
}

function headlineAmount(title: string | null): string | null {
  const match = title?.match(/([$£€₹])\s*(\d+(?:\.\d+)?)\s*(million|billion|trillion|[mbt]\b)?/i);
  if (!match) return null;
  const scale = { m: 1e6, b: 1e9, t: 1e12 }[match[3]?.[0].toLowerCase() ?? ''] ?? 1;
  return `${match[1]}${Number(match[2]) * scale}`;
}

export function clusterNewsRecords(
  records: readonly NewsRecord[],
  { editorial = false }: { editorial?: boolean } = {}
): NewsRecord[][] {
  const n = records.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const members = Array.from({ length: n }, (_, i) => [i]);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
      members[ra].push(...members[rb]);
      members[rb] = [];
    }
  };

  const urls = records.map(newsCanonicalUrl);
  const tokens = records.map((record) => titleTokens(record.title));
  const eventTokens = tokens.map(
    (set) => new Set([...set].filter((token) => EVENT_TOKENS.has(token)))
  );
  const subjects = records.map((record) => newsSubject(record.title ?? ''));
  const headlineSubjects = records.map((record) =>
    (record.title ?? '').match(/^[A-Z][A-Za-z0-9]+/)?.[0].toLowerCase()
  );
  const headlineAmounts = records.map((record) =>
    editorial ? headlineAmount(record.title) : null
  );
  const sameEvent = (i: number, j: number) => {
    if (urls[i] && urls[i] === urls[j]) return true;
    // Front-edition grouping may join differently phrased accounts. It grants
    // no corroboration credit and cannot change stored clusters or snapshots.
    if (
      editorial &&
      Math.abs(
        toDate(records[i].publishedAt).getTime() - toDate(records[j].publishedAt).getTime()
      ) >
        36 * 3_600_000
    )
      return false;
    const entityI = records[i].primaryEntityId?.trim();
    const entityJ = records[j].primaryEntityId?.trim();
    if (entityI && entityJ && entityI !== entityJ) return false;
    if (
      editorial &&
      headlineAmounts[i] &&
      headlineAmounts[j] &&
      headlineAmounts[i] !== headlineAmounts[j]
    )
      return false;
    // Topic words and a shared investor are not the subject of a news event.
    // Ambiguous titles stay separate rather than acquire unrelated citations.
    const strictSubject = subjects[i] && subjects[i] === subjects[j];
    const headlineSubject =
      editorial &&
      headlineSubjects[i] &&
      headlineSubjects[i] === headlineSubjects[j] &&
      !isGenericNewsToken(headlineSubjects[i]!);
    if (!(entityI && entityI === entityJ) && !strictSubject && !headlineSubject) return false;
    const sharedContext = [...tokens[i]].filter(
      (token) => tokens[j].has(token) && !isGenericNewsToken(token)
    );
    if (!setsIntersect(eventTokens[i], eventTokens[j])) {
      // Distinct explicit events (e.g. an acquisition and a launch) stay apart.
      // Missing event verbs need stronger distinctive headline overlap.
      const sameAmount = headlineAmounts[i] && headlineAmounts[i] === headlineAmounts[j];
      const sharedTerms = [...tokens[i]].filter((token) => tokens[j].has(token));
      return Boolean(
        headlineSubject &&
          !(eventTokens[i].size && eventTokens[j].size) &&
          ((sharedContext.length >= 3 && jaccard(tokens[i], tokens[j]) >= 0.25) ||
            (sharedContext.length >= 1 && sharedTerms.length >= 2 && sameAmount))
      );
    }
    return jaccard(tokens[i], tokens[j]) >= JACCARD_THRESHOLD || sharedContext.length >= 2;
  };
  const byUrl = new Map<string, number[]>();
  urls.forEach((url, index) => {
    if (!url) return;
    const bucket = byUrl.get(url) ?? [];
    bucket.push(index);
    byUrl.set(url, bucket);
  });
  for (const idxs of byUrl.values()) {
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
  }

  for (let i = 0; i < n; i++) {
    if (tokens[i].size === 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j) || tokens[j].size === 0) continue;
      if (!sameEvent(i, j)) continue;
      // Single-link clustering lets a broad headline bridge two different
      // events. Every incoming source must align with every existing member.
      if (!members[find(i)].every((a) => members[find(j)].every((b) => sameEvent(a, b)))) continue;
      union(i, j);
    }
  }

  const groups = new Map<number, NewsRecord[]>();
  records.forEach((record, index) => {
    const root = find(index);
    const members = groups.get(root) ?? [];
    members.push(record);
    groups.set(root, members);
  });
  return [...groups.values()];
}

export function composeNewsStories(
  records: readonly NewsRecord[],
  window: NewsReportingWindow
): BriefNewsItem[] {
  const selected = selectNewsRecords(records, window);
  const clusters = clusterNewsRecords(selected);
  const ranked = clusters
    .map((members) => storyFromCluster(members, window))
    .filter((story): story is RankedNews => story != null)
    .sort((a, b) => {
      if (a.trendSources !== b.trendSources) return b.trendSources - a.trendSources;
      if (a.crossChannel !== b.crossChannel) return Number(b.crossChannel) - Number(a.crossChannel);
      if (a.publisherSources !== b.publisherSources) {
        return b.publisherSources - a.publisherSources;
      }
      if (a.attentionChannels !== b.attentionChannels) {
        return b.attentionChannels - a.attentionChannels;
      }
      if (a.importance !== b.importance) return b.importance - a.importance;
      if (a.novelty !== b.novelty) return b.novelty - a.novelty;
      if (a.evidence !== b.evidence) return b.evidence - a.evidence;
      return b.eventAtMs - a.eventAtMs;
    });
  return ranked.map((story) => story.item);
}

function newsCanonicalUrl(record: NewsRecord): string {
  const embedded = record.content ? LINK_RE.exec(record.content)?.[1] : null;
  const canonical = canonicalizeNewsUrl(embedded ?? record.sourceUrl);
  // Historical structured observations shared agency landing URLs. Those
  // URLs identify a collection, not an alert/contract, and cannot join rows.
  return hasSharedStructuredUrl(record) ? `${canonical}::${record.id}` : canonical;
}

function hasSharedStructuredUrl(record: Pick<NewsRecord, 'source' | 'sourceUrl'>): boolean {
  if (!['us-gov-api:noaa-weather', 'us-gov-api:cftc-cot'].includes(record.source)) return false;
  try {
    const url = new URL(record.sourceUrl);
    return (
      (record.source.endsWith(':noaa-weather') && url.pathname.replace(/\/$/, '') === '') ||
      (record.source.endsWith(':cftc-cot') &&
        /\/CommitmentsofTraders\/index.htm$/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function canonicalizeNewsUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/$/, '').toLowerCase();
    const kept = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length
      ? `?${kept.map(([key, val]) => `${key.toLowerCase()}=${val}`).join('&')}`
      : '';
    if (!host) return canonicalSourceUrl(value);
    return `${host}${path}${query}`;
  } catch {
    return canonicalSourceUrl(value).toLowerCase();
  }
}

export function hasUsableRetainedText(
  record: Pick<NewsRecord, 'title' | 'content' | 'retainedText'> &
    Partial<Pick<NewsRecord, 'source'>>
): boolean {
  const retained = retainedBody(record);
  if (!retained) return false;
  if (
    RETAINED_TEXT_BLOCKERS.some((marker) =>
      retained.slice(0, RETAINED_BLOCKER_SCAN_MAX).toLowerCase().includes(marker)
    )
  ) {
    return false;
  }
  const title = (record.title ?? '').trim();
  if (ROUTINE_IR_SNAPSHOT_RE.test(title)) return false;
  if (ROUTINE_EARNINGS_CALENDAR_RE.test(title)) return false;
  if (LOW_VALUE_NEWS_TITLE_RE.test(title)) return false;
  if (!title) return retained.length >= 80;
  if (retained === title || retained.length <= Math.max(title.length, TITLE_ONLY_MAX)) return false;
  return retained.length >= 80;
}

function storyFromCluster(members: NewsRecord[], window: NewsReportingWindow): RankedNews | null {
  const usable = members.filter(hasUsableRetainedText);
  if (usable.length === 0) return null;
  const representative = usable.reduce((best, record) =>
    rankRecord(record) > rankRecord(best) ? record : best
  );
  const title = decodeHtmlCharacterReferences(representative.title ?? '').trim();
  if (!title) return null;
  const excerpt = retainedBody(representative);
  if (!excerpt) return null;
  const summary = summarizeRetained(excerpt, title);
  if (!summary) return null;
  const references = sourceReferences(usable);
  if (references.length === 0) return null;
  const evidenceStatus = evidenceStatusFor(usable, references);
  const eventAt = earliestPublished(usable);
  const whatChanged = whatChangedInWindow(usable, window, summary);
  const trend = trendStrength(usable);
  const item: BriefNewsItem = {
    id: clusterId(usable),
    title,
    summary,
    event_at: eventAt.toISOString(),
    what_changed: whatChanged,
    source_references: references,
    evidence_status: evidenceStatus,
  };
  return {
    item,
    ...trend,
    importance: importanceScore(usable, evidenceStatus, trend.trendSources),
    novelty: noveltyScore(usable, window),
    evidence: evidenceScore(excerpt, trend.publisherSources),
    eventAtMs: eventAt.getTime(),
  };
}

interface RankedNews {
  item: BriefNewsItem;
  trendSources: number;
  publisherSources: number;
  attentionChannels: number;
  crossChannel: boolean;
  importance: number;
  novelty: number;
  evidence: number;
  eventAtMs: number;
}

function trendStrength(
  members: readonly NewsRecord[]
): Pick<RankedNews, 'trendSources' | 'publisherSources' | 'attentionChannels' | 'crossChannel'> {
  const publishers = new Set<string>();
  const attention = new Set<string>();
  for (const member of members) {
    const family = sourceFamily(member.source);
    if (ATTENTION_SOURCE_FAMILIES.has(family)) {
      attention.add(family);
      continue;
    }
    try {
      const protocol = new URL(member.sourceUrl).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const domain = sourceDomain(member.sourceUrl);
    if (domain) publishers.add(domain);
  }
  return {
    trendSources: publishers.size + attention.size,
    publisherSources: publishers.size,
    attentionChannels: attention.size,
    crossChannel: publishers.size > 0 && attention.size > 0,
  };
}

function retainedBody(
  record: Pick<NewsRecord, 'title' | 'content' | 'retainedText'> &
    Partial<Pick<NewsRecord, 'source'>>
): string | null {
  // Old agency records can point at a document shared by unrelated alerts or
  // report contracts. The event-local structured payload retains its identity.
  const eventLocal = ['us-gov-api:noaa-weather', 'us-gov-api:cftc-cot'].includes(
    record.source ?? ''
  );
  const raw = ((eventLocal ? record.content : null) ?? record.retainedText ?? record.content ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;
  return raw.slice(0, EXCERPT_MAX);
}

const NAMED_TEXT_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['apos', "'"],
  ['bull', '•'],
  ['cent', '¢'],
  ['copy', '©'],
  ['deg', '°'],
  ['divide', '÷'],
  ['euro', '€'],
  ['gt', '>'],
  ['hellip', '…'],
  ['laquo', '«'],
  ['ldquo', '“'],
  ['larr', '←'],
  ['lsquo', '‘'],
  ['lt', '<'],
  ['mdash', '—'],
  ['micro', 'µ'],
  ['middot', '·'],
  ['nbsp', ' '],
  ['ndash', '–'],
  ['para', '¶'],
  ['pound', '£'],
  ['plusmn', '±'],
  ['quot', '"'],
  ['raquo', '»'],
  ['reg', '®'],
  ['rdquo', '”'],
  ['rarr', '→'],
  ['rsquo', '’'],
  ['sect', '§'],
  ['thinsp', '\u2009'],
  ['trade', '™'],
  ['times', '×'],
  ['uarr', '↑'],
  ['yen', '¥'],
]);

const C1_CODE_POINT_REPLACEMENTS = new Map<number, number>([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x2c6],
  [0x89, 0x2030],
  [0x8a, 0x160],
  [0x8b, 0x2039],
  [0x8c, 0x152],
  [0x8e, 0x17d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x2dc],
  [0x99, 0x2122],
  [0x9a, 0x161],
  [0x9b, 0x203a],
  [0x9c, 0x153],
  [0x9e, 0x17e],
  [0x9f, 0x178],
]);

function decodeHtmlCharacterReferences(value: string): string {
  return value.replace(/&(#(?:x[\da-f]+|\d+);?|[a-z][a-z\d]+;)/gi, (reference, entity: string) => {
    const hasSemicolon = entity.endsWith(';');
    const value = hasSemicolon ? entity.slice(0, -1) : entity;
    if (!value.startsWith('#')) {
      return NAMED_TEXT_ENTITIES.get(value) ?? reference;
    }

    const hexadecimal = value[1]?.toLowerCase() === 'x';
    let codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (codePoint >= 0x80 && codePoint <= 0x9f) {
      codePoint = C1_CODE_POINT_REPLACEMENTS.get(codePoint) ?? codePoint;
    }
    if (
      !Number.isInteger(codePoint) ||
      codePoint === 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return '\ufffd';
    }
    return String.fromCodePoint(codePoint);
  });
}

function cleanRetainedText(excerpt: string, title: string): string {
  let cleaned = decodeHtmlCharacterReferences(excerpt)
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^listen to this article in summarized format\s*/i, '')
    .replace(/^\(this is the .{0,300}? newsletter,.{0,500}?\)\s*/i, '');
  if (cleaned.toLowerCase().startsWith(title.toLowerCase())) {
    cleaned = cleaned.slice(title.length).replace(/^[\s—:.-]+/, '');
  }
  return cleaned;
}

function summarizeRetained(excerpt: string, title: string): string | null {
  const cleaned = cleanRetainedText(excerpt, title);
  if (
    RETAINED_TEXT_BLOCKERS.some((marker) =>
      cleaned.slice(0, RETAINED_BLOCKER_SCAN_MAX).toLowerCase().includes(marker)
    )
  )
    return null;
  let picked = summarySentences(cleaned, SUMMARY_MAX_SENTENCES);
  if (!excerptMatchesHeadline(title, picked)) {
    // A digest may open with another story. Take a complete subject-bearing
    // reporting sentence from its retained body, never the unrelated intro or
    // a contents/navigation heading. With no such sentence, withhold it.
    const subject = excerptSubject(title);
    const leadPattern = subject
      ? new RegExp(
          `\\b${subject}\\s+(?:reported|announced|confirmed|said|released|launched|posted|lowered|raised|unveiled|disclosed)\\b`,
          'i'
        )
      : null;
    const sentence = leadPattern
      ? cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).find((span) => leadPattern.test(span))
      : null;
    if (!sentence || sentence.length > 480) return null;
    // Retain the entire original span: prefixes such as "It is false that"
    // and "According to an unconfirmed report" change the claim's meaning.
    picked = sentence.trim();
    if (!excerptMatchesHeadline(title, picked)) return null;
  }
  if (picked.length < 24) return null;
  return picked.length > 480 ? `${picked.slice(0, 477).replace(/\s+\S*$/, '')}…` : picked;
}

function summarySentences(text: string, limit: number): string {
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);
  return (sentences.length ? sentences : [text]).slice(0, limit).join(' ').trim();
}

const GENERIC_EXCERPT_LEADS = new Set(
  'the a an its it this that these those we our you your dear new how why what when where who after before according researchers officials company report reports ai api open security technology tech software cloud market markets news latest exclusive breaking developers developer launch launches guide top best'.split(
    ' '
  )
);
const EXCERPT_SUBJECT_CONTEXT = new Set(
  'announces announced launches launched releases released ships shipped reports reported confirms confirmed says said raises raised lowers lowered unveils unveiled discloses disclosed acquires acquired closes closed cuts wins builds woos ceo ai revenue shares profit earnings model chip safety'.split(
    ' '
  )
);

function excerptSubject(title: string): string | null {
  const first = title.trim().match(/^[A-Z][A-Za-z0-9]+/)?.[0];
  if (!first || first.length < 3 || GENERIC_EXCERPT_LEADS.has(first.toLowerCase())) return null;
  const second = title
    .trim()
    .slice(first.length)
    .match(/^\s+([A-Za-z]+)/)?.[1];
  if (!second || !EXCERPT_SUBJECT_CONTEXT.has(second.toLowerCase())) {
    if (first !== first.toUpperCase() && !/[A-Z]/.test(first.slice(1))) return null;
  }
  return first.toLowerCase();
}

/** Detect clear cross-story/navigation excerpts without requiring verbatim paraphrases. */
function excerptMatchesHeadline(title: string, summary: string): boolean {
  if (/^CFTC CoT:/i.test(title)) {
    const contract = title.replace(/^CFTC CoT:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '');
    const normalized = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return normalized(summary).includes(normalized(contract));
  }
  const weather = title.match(
    /^((?:(?:severe )?thunderstorm|small craft|tornado|flood|winter storm|heat|wind|weather) (?:advisory|warning|watch))\b/i
  );
  if (weather && !summary.toLowerCase().startsWith(weather[1].toLowerCase())) return false;
  const subject = excerptSubject(title);
  if (!subject || new RegExp(`\\b${subject}\\b`, 'i').test(summary)) return true;
  if (/^(?:dear reader\b|(?:ai|infosec|foss)\s*[-•])/i.test(summary)) return false;
  if ((summary.match(/(?:^|\s)[-•]\s/g)?.length ?? 0) >= 3) return false;
  // "The company..." is a legitimate paraphrase. A different explicit named
  // lead, such as Nvidia under an IBM headline, is not.
  return excerptSubject(summary) === null;
}

/** Re-apply current reader-quality rules when an incremental rebuild has no new story. */
export function sanitizeBriefNewsItems(items: readonly BriefNewsItem[]): BriefNewsItem[] {
  const sanitized: BriefNewsItem[] = [];
  for (const item of items) {
    const title = item.title.trim();
    if (!title || ROUTINE_IR_SNAPSHOT_RE.test(title) || LOW_VALUE_NEWS_TITLE_RE.test(title)) {
      continue;
    }
    const summary = cleanRetainedText(item.summary, title);
    if (
      summary.length < 24 ||
      RETAINED_TEXT_BLOCKERS.some((marker) => summary.toLowerCase().includes(marker)) ||
      !excerptMatchesHeadline(title, summary)
    ) {
      continue;
    }
    const publicReferences = item.source_references.filter((citation) => {
      try {
        const protocol = new URL(citation.url).protocol;
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    });
    if (isPredictionMarketOnly(publicReferences.map((citation) => citation.url))) continue;
    const relevantReferences = publicReferences.filter((citation) =>
      citationMatchesTitle(citation.url, title)
    );
    const sourceReferences = relevantReferences.length
      ? relevantReferences
      : newsSubject(title)
        ? []
        : publicReferences.slice(0, 1);
    if (sourceReferences.length === 0) {
      console.warn('[brief-news] cached story withheld', {
        id: item.id,
        reason: 'no_subject_aligned_citation',
      });
      continue;
    }
    const cleanedWhatChanged = cleanRetainedText(item.what_changed, title);
    const whatChanged = cleanedWhatChanged === summary ? '' : cleanedWhatChanged;
    sanitized.push({
      ...item,
      title,
      summary,
      what_changed: whatChanged,
      source_references: sourceReferences,
    });
  }
  return sanitized;
}

function citationMatchesTitle(url: string, title: string): boolean {
  try {
    const parsed = new URL(url);
    const urlTokens = titleTokens(`${parsed.hostname} ${decodeURIComponent(parsed.pathname)}`);
    const subject = newsSubject(title);
    if (subject && !urlTokens.has(subject)) return false;
    const identityTokens = [...titleTokens(title)].filter(
      (token) => !COMPANYISH_STOP.has(token) && !EVENT_TOKENS.has(token) && !/^\d+$/.test(token)
    );
    return identityTokens.filter((token) => urlTokens.has(token)).length >= 2;
  } catch {
    return false;
  }
}

function sourceReferences(members: NewsRecord[]): BriefCitation[] {
  const seen = new Set<string>();
  const out: BriefCitation[] = [];
  for (const member of members) {
    const url = member.sourceUrl.trim();
    if (!url || seen.has(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    seen.add(url);
    out.push({ url, source: sourceFamily(member.source), recordId: member.id });
  }
  return out;
}

function evidenceStatusFor(
  members: NewsRecord[],
  references: BriefCitation[]
): BriefNewsEvidenceStatus {
  const classes = new Set(references.map((citation) => classifySource(citation.url)));
  const families = new Set(members.map((member) => sourceFamily(member.source)));
  const officialFamily = [...families].some((family) =>
    [
      'edgar',
      'sec-xbrl',
      'ir',
      'hkex',
      'courtlistener',
      'legistar',
      'openstates',
      'regulations',
      'gov',
      'gov-contracts',
    ].includes(family)
  );
  if (classes.has('official') || officialFamily) return 'official';
  const reported =
    classes.has('news') ||
    families.has('news') ||
    families.has('guardian') ||
    families.has('techmeme');
  const attentionOnly = [...families].every((family) =>
    ['hackernews', 'reddit', 'digg', 'mts', 'lobsters', 'producthunt', 'bluesky'].includes(family)
  );
  if (reported && !attentionOnly) return 'reported';
  return 'unverified';
}

function importanceScore(
  members: NewsRecord[],
  status: BriefNewsEvidenceStatus,
  independentSourceCount: number
): number {
  const maxRank = Math.max(...members.map(rankRecord));
  const statusBoost = status === 'official' ? 30 : status === 'reported' ? 18 : 4;
  const eventBoost = members.some((member) =>
    [...titleTokens(member.title)].some((token) => EVENT_TOKENS.has(token))
  )
    ? 8
    : 0;
  return maxRank + statusBoost + eventBoost + Math.min(independentSourceCount, 4);
}

function noveltyScore(members: NewsRecord[], window: NewsReportingWindow): number {
  const newest = Math.max(...members.map((member) => toDate(member.ingestedAt).getTime()));
  const ageHours = Math.max(0, (window.end.getTime() - newest) / 3_600_000);
  return Math.max(0, 48 - ageHours);
}

function evidenceScore(excerpt: string, publisherSourceCount: number): number {
  return Math.min(excerpt.length / 80, 20) + Math.min(publisherSourceCount, 5);
}

function whatChangedInWindow(
  members: NewsRecord[],
  window: NewsReportingWindow,
  summary: string
): string {
  const prior = members.filter(
    (member) => toDate(member.ingestedAt).getTime() < window.start.getTime()
  );
  if (prior.length === 0) return '';
  const fresh = members.filter(
    (member) => toDate(member.ingestedAt).getTime() >= window.start.getTime()
  );
  if (fresh.length === 0) return '';
  const latest = fresh.reduce((best, record) =>
    toDate(record.ingestedAt).getTime() >= toDate(best.ingestedAt).getTime() ? record : best
  );
  const body = retainedBody(latest);
  return body ? summarizeRetained(body, latest.title ?? '') || summary : summary;
}

function clusterId(members: NewsRecord[]): string {
  const keys = members
    .map((member) => newsCanonicalUrl(member) || member.id)
    .filter(Boolean)
    .sort();
  const seed =
    keys.join('|') ||
    members
      .map((member) => member.id)
      .sort()
      .join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `news-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function rankRecord(record: NewsRecord): number {
  // Preserve the original-publisher retrieval priority after generic-topic
  // clusters split. This is selection priority, never a verification label.
  const originalPublisher = /^news:(digg|mts)-verification:/.test(record.source);
  return (SOURCE_RANK[sourceFamily(record.source)] ?? 0) + Number(originalPublisher);
}

function sourceFamily(source: string): string {
  const normalized = source || 'unknown';
  if (normalized.startsWith('edgar_')) return 'edgar';
  return normalized.split(':', 1)[0] ?? normalized;
}

function titleTokens(title: string | null | undefined): Set<string> {
  if (!title) return new Set();
  const stripped = title.replace(PREFIX_RE, '');
  const words = stripped.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((word) => !STOP.has(word) && word.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter === 0 ? 0 : inter / new Set([...a, ...b]).size;
}

function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) if (b.has(token)) return true;
  return false;
}

function isGenericNewsToken(token: string): boolean {
  return (
    COMPANYISH_STOP.has(token) ||
    EVENT_TOKENS.has(token) ||
    BRIEF_NEWS_TOPICS.has(token) ||
    ['lab', 'labs', 'series', 'round', 'million', 'billion', 'valuation'].includes(token) ||
    /^\d+$/.test(token)
  );
}

/** A conservative headline subject hint, not a semantic verification receipt. */
function newsSubject(title: string): string | null {
  const words = title.replace(PREFIX_RE, '').match(/[A-Za-z0-9]+/g) ?? [];
  const event = words.findIndex((word) => EVENT_TOKENS.has(word.toLowerCase()));
  if (event < 0) return null;
  const prefix = words
    .slice(0, event)
    .filter((word) => word.length > 2 && !isGenericNewsToken(word.toLowerCase()));
  const named = prefix.filter((word) => /[A-Z]/.test(word));
  return (named.at(-1) ?? prefix.at(-1))?.toLowerCase() ?? null;
}

function earliestPublished(members: NewsRecord[]): Date {
  return members.reduce((earliest, record) => {
    const at = toDate(record.publishedAt);
    return at.getTime() < earliest.getTime() ? at : earliest;
  }, toDate(members[0].publishedAt));
}

function toDate(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  return new Date(value);
}
