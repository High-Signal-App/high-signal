/**
 * News-first Daily Brief: select, group, rank, and summarize retained records.
 * Independent of cite-or-kill market-signal gates. Never invents copy.
 */

import { canonicalSourceUrl } from './source-document';
import { classifySource } from './signal-intelligence';
import type { BriefCitation, BriefNewsEvidenceStatus, BriefNewsItem } from './brief';

export const NEWS_LIMIT = 8;
export const DEFAULT_NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
const JACCARD_THRESHOLD = 0.72;
const TITLE_ONLY_MAX = 80;
const SUMMARY_MAX_SENTENCES = 3;
const EXCERPT_MAX = 1200;

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

const PAYWALL_MARKERS = [
  'please log in',
  'please login',
  'sign in to continue',
  'subscribe to read',
  'subscription required',
  'create an account to continue',
  'this content is for subscribers',
  'paywall',
];

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

export interface NewsReportingWindow {
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

export function selectNewsRecords(
  records: readonly NewsRecord[],
  window: NewsReportingWindow
): NewsRecord[] {
  const inWindow = (value: Date) =>
    value.getTime() >= window.start.getTime() && value.getTime() <= window.end.getTime();

  const selected: NewsRecord[] = [];
  for (const members of clusterNewsRecords(records)) {
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

export function clusterNewsRecords(records: readonly NewsRecord[]): NewsRecord[][] {
  const n = records.length;
  const parent = Array.from({ length: n }, (_, i) => i);
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
    if (ra !== rb) parent[rb] = ra;
  };

  const urls = records.map(newsCanonicalUrl);
  const tokens = records.map((record) => titleTokens(record.title));
  const eventTokens = tokens.map(
    (set) => new Set([...set].filter((token) => EVENT_TOKENS.has(token)))
  );
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
      if (jaccard(tokens[i], tokens[j]) < JACCARD_THRESHOLD) continue;
      if (eventTokens[i].size === 0 || eventTokens[j].size === 0) continue;
      if (!setsIntersect(eventTokens[i], eventTokens[j])) continue;
      if (companyOnlyOverlap(tokens[i], tokens[j], eventTokens[i], eventTokens[j])) continue;
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
      if (a.importance !== b.importance) return b.importance - a.importance;
      if (a.novelty !== b.novelty) return b.novelty - a.novelty;
      if (a.evidence !== b.evidence) return b.evidence - a.evidence;
      return b.eventAtMs - a.eventAtMs;
    })
    .slice(0, NEWS_LIMIT);
  return ranked.map((story) => story.item);
}

export function newsCanonicalUrl(record: Pick<NewsRecord, 'sourceUrl' | 'content'>): string {
  const embedded = record.content ? LINK_RE.exec(record.content)?.[1] : null;
  return canonicalizeNewsUrl(embedded ?? record.sourceUrl);
}

export function canonicalizeNewsUrl(value: string | null | undefined): string {
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
  record: Pick<NewsRecord, 'title' | 'content' | 'retainedText'>
): boolean {
  const retained = retainedBody(record);
  if (!retained) return false;
  if (PAYWALL_MARKERS.some((marker) => retained.toLowerCase().includes(marker))) return false;
  const title = (record.title ?? '').trim();
  if (!title) return retained.length >= 80;
  if (retained === title || retained.length <= Math.max(title.length, TITLE_ONLY_MAX)) return false;
  return retained.length >= 80;
}

function storyFromCluster(members: NewsRecord[], window: NewsReportingWindow): RankedNews | null {
  const usable = members.filter(hasUsableRetainedText);
  if (usable.length === 0) return null;
  const representative = usable.reduce((best, record) =>
    rankRecord(record) >= rankRecord(best) ? record : best
  );
  const title = (representative.title ?? '').trim();
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
    importance: importanceScore(usable, evidenceStatus),
    novelty: noveltyScore(usable, window),
    evidence: evidenceScore(usable, excerpt),
    eventAtMs: eventAt.getTime(),
  };
}

interface RankedNews {
  item: BriefNewsItem;
  importance: number;
  novelty: number;
  evidence: number;
  eventAtMs: number;
}

function retainedBody(
  record: Pick<NewsRecord, 'title' | 'content' | 'retainedText'>
): string | null {
  const raw = (record.retainedText ?? record.content ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return raw.slice(0, EXCERPT_MAX);
}

function summarizeRetained(excerpt: string, title: string): string | null {
  const cleaned = excerpt
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (PAYWALL_MARKERS.some((marker) => cleaned.toLowerCase().includes(marker))) return null;
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24 && sentence !== title);
  const picked = (sentences.length ? sentences : [cleaned])
    .slice(0, SUMMARY_MAX_SENTENCES)
    .join(' ')
    .trim();
  if (picked.length < 24) return null;
  return picked.length > 480 ? `${picked.slice(0, 477).replace(/\s+\S*$/, '')}…` : picked;
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
    out.push({ url, source: sourceFamily(member.source) });
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

function importanceScore(members: NewsRecord[], status: BriefNewsEvidenceStatus): number {
  const maxRank = Math.max(
    ...members.map((member) => SOURCE_RANK[sourceFamily(member.source)] ?? 1)
  );
  const statusBoost = status === 'official' ? 30 : status === 'reported' ? 18 : 4;
  const eventBoost = members.some((member) =>
    [...titleTokens(member.title)].some((token) => EVENT_TOKENS.has(token))
  )
    ? 8
    : 0;
  return maxRank + statusBoost + eventBoost + Math.min(members.length, 4);
}

function noveltyScore(members: NewsRecord[], window: NewsReportingWindow): number {
  const newest = Math.max(...members.map((member) => toDate(member.ingestedAt).getTime()));
  const ageHours = Math.max(0, (window.end.getTime() - newest) / 3_600_000);
  return Math.max(0, 48 - ageHours);
}

function evidenceScore(members: NewsRecord[], excerpt: string): number {
  return Math.min(excerpt.length / 80, 20) + Math.min(members.length, 5);
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
  return SOURCE_RANK[sourceFamily(record.source)] ?? 0;
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

function companyOnlyOverlap(
  a: Set<string>,
  b: Set<string>,
  aEvents: Set<string>,
  bEvents: Set<string>
): boolean {
  const shared = new Set([...a].filter((token) => b.has(token)));
  const sharedEvents = [...shared].filter((token) => EVENT_TOKENS.has(token));
  if (sharedEvents.length > 0) return false;
  const leftover = [...shared].filter(
    (token) => !COMPANYISH_STOP.has(token) && !EVENT_TOKENS.has(token)
  );
  return (
    leftover.length === 0 &&
    aEvents.size > 0 &&
    bEvents.size > 0 &&
    !setsIntersect(aEvents, bEvents)
  );
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
