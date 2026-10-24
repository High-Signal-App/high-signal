/** A bounded front edition over the complete retained news collection. */
import type { BriefNewsItem, BriefSnapshot } from './brief';
import { clusterNewsRecords } from './brief-news';
import { istDayRange } from './history-access';
import { sourceDomain } from './signal-intelligence';

const MAX_STORIES = 8;
const MAX_PER_PUBLISHER = 2;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const PROMOTION =
  /\b(?:job openings|job board|hiring roundup|sponsored|giveaway|discount|coupon|waitlist|webinar|masterclass)\b|\b(?:how to|guide to|top \d+|best \d+|just hit #?1|not much happened)\b/i;
const CONSEQUENCE =
  /\b(?:breach|outage|incident|vulnerability|vulnerabilities|shutdown|shuts down|recall|antitrust|lawsuit|sues|ban|banned|layoffs?|bankruptcy|default|security release)\b/i;
const CHANGE =
  /\b(?:launch(?:es|ed)?|releas(?:e|es|ed)|ships?|acquir(?:e|es|ed)|acquisition|merger|earnings|profit|revenue|ipo|raises?|funding|rates?|tariffs?|regulat(?:ion|or))\b/i;
const FUNDING = /\b(?:raises?|funding|series [a-f]|venture fund)\b/i;
const ROUTINE_RECORD =
  /^(?:Congress:|CFTC CoT:|(?:small craft|weather|wind|flood|thunderstorm|tornado|winter storm) (?:advisory|warning|watch)\b)/i;
const HEADLINE_STOP = new Set(
  'the a an and or for from with into that this these those what why how who its are was were has have had will would could should says said new now more most after before during about their they them than then also while here there does can not our your you his her but on off out over under per'.split(
    ' '
  )
);
const GENERIC_ANCHOR = new Set(
  'ai api model models open weight weights company companies software technology tech data security cloud market markets revenue report reports'.split(
    ' '
  )
);

function headlineTerms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(
    (word) => word.length > 2 && !HEADLINE_STOP.has(word)
  );
}

/** Reject off-topic scraped navigation/digest intros even when the URL is valid. */
function hasAlignedExcerpt(item: BriefNewsItem): boolean {
  const title = headlineTerms(item.title);
  const body = new Set(headlineTerms(item.summary));
  const matched = title.filter((word) => body.has(word));
  return matched.length >= 2 && matched.some((word) => !GENERIC_ANCHOR.has(word));
}
// The raw collection is intentionally broad. Front-page selection requires an
// explicit technology, startup or finance hook in the headline itself.
const LENS =
  /\b(?:ai|api|apps?|software|database|cloud|data|security|breach|cyber|vulnerabilit(?:y|ies)|chips?|semiconductors?|robots?|robotics|gpu|cpu|model|models|internet|startup|founders?|funding|raises?|venture|ipo|shares?|stocks?|markets?|earnings|profit|revenue|economy|economic|treasury|tariffs?|rates?|banking|finance|financial|fintech|trade|investment|investors?|openai|anthropic|nvidia|apple|google|microsoft|spacex)\b/i;

export interface BriefEditionStory {
  story: BriefNewsItem;
  /** Separate attributed accounts, never additional support credit for the lead claim. */
  related: BriefNewsItem[];
}

function publishers(item: BriefNewsItem): string[] {
  return [...new Set(item.source_references.map(({ url }) => sourceDomain(url)).filter(Boolean))];
}

function editorialScore(item: BriefNewsItem, editionEnd: number): number {
  const ageHours = Math.max(0, (editionEnd - Date.parse(item.event_at)) / 3_600_000);
  return (
    (CONSEQUENCE.test(item.title) ? 8 : CHANGE.test(item.title) ? 5 : 0) +
    (item.evidence_status === 'official' ? 2 : 0) +
    Math.min(publishers(item).length - 1, 2) * 2 -
    Math.floor(ageHours / 24) * 3
  );
}

/**
 * Selection changes presentation only. Original snapshots, claims, citations and
 * their evidence labels remain intact, and every story stays in the full stream.
 * No attention-only or promotional filler is used to reach the eight-story cap.
 */
export function selectBriefEdition(brief: BriefSnapshot) {
  const news = brief.news ?? [];
  const editionEnd = Math.min(
    istDayRange(brief.editionDate ?? brief.generatedAt.slice(0, 10))?.end.getTime() ?? Infinity,
    Date.parse(brief.generatedAt)
  );
  const eligible = news.filter((item) => {
    const at = Date.parse(item.event_at);
    return (
      item.evidence_status !== 'unverified' &&
      Number.isFinite(at) &&
      at <= editionEnd &&
      editionEnd - at <= MAX_AGE_MS &&
      (LENS.test(item.title) || /\b(?:Intel|Meta)\b/.test(item.title)) &&
      !PROMOTION.test(item.title) &&
      !ROUTINE_RECORD.test(item.title) &&
      hasAlignedExcerpt(item)
    );
  });
  const byId = new Map(eligible.map((item) => [item.id, item]));
  // Reuse the conservative, complete-link event matcher: a company or topic
  // alone cannot join stories, and a broad headline cannot bridge two events.
  const groups = clusterNewsRecords(
    eligible.map((item) => ({
      id: item.id,
      source: 'news',
      sourceUrl: item.source_references[0]?.url ?? '',
      publishedAt: item.event_at,
      ingestedAt: item.event_at,
      title: item.title,
      content: item.summary,
      retainedText: item.summary,
    })),
    { editorial: true }
  ).map((group) => {
    const accounts = group
      .map(({ id }) => byId.get(id)!)
      .sort(
        (a, b) =>
          editorialScore(b, editionEnd) - editorialScore(a, editionEnd) ||
          Date.parse(b.event_at) - Date.parse(a.event_at) ||
          a.id.localeCompare(b.id)
      );
    return { story: accounts[0]!, related: accounts.slice(1) };
  });
  groups.sort(
    (a, b) =>
      editorialScore(b.story, editionEnd) - editorialScore(a.story, editionEnd) ||
      Date.parse(b.story.event_at) - Date.parse(a.story.event_at) ||
      a.story.id.localeCompare(b.story.id)
  );

  const counts = new Map<string, number>();
  let fundingCount = 0;
  const items: BriefEditionStory[] = [];
  for (const group of groups) {
    const domain = publishers(group.story)[0];
    if (!domain || (counts.get(domain) ?? 0) >= MAX_PER_PUBLISHER) continue;
    const funding = FUNDING.test(group.story.title);
    if (funding && fundingCount >= 2) continue;
    items.push(group);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
    if (funding) fundingCount++;
    if (items.length === MAX_STORIES) break;
  }
  const words = items.reduce(
    (count, { story }) =>
      count + `${story.title} ${story.summary} ${story.what_changed}`.split(/\s+/).length,
    0
  );
  return { items, total: news.length, readingMinutes: Math.max(1, Math.ceil(words / 200)) };
}
