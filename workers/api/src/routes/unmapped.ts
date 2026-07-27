/**
 * Gazetteer-expansion triage: events landing with no entity match in the
 * last N hours, with $TICKER tokens extracted + ranked by mention count.
 *
 * Use case: when an event hits but `primary_entity_id IS NULL`, the entity
 * isn't in `ai_infra_entities.csv` yet. The top tokens here are candidates
 * to add to the gazetteer.
 */

import { Hono } from 'hono';
import knownTickersJson from '../lib/known-tickers.json';
import seedEntities from '../lib/seed-entities.json';

type Env = { DB: D1Database };

interface UnmappedEvent {
  title: string | null;
  content: string | null;
  source: string;
  source_url: string;
  published_at: number;
}

interface Candidate {
  token: string;
  count: number;
  sources: string[];
  samples: Array<{
    title: string;
    source: string;
    source_url: string;
    published_at: number;
  }>;
}

const TICKER_RE = /\$[A-Z]{1,5}(?:\.[A-Z]{1,3})?\b/g;
const STOP_TOKENS = new Set(['$USD', '$EUR', '$GBP', '$JPY']);

// Bare-ticker detection: uppercase 3-5 char alphabetic tokens that match
// a real symbol in the equities universe. The length floor at 3 is a
// pragmatic call — 1- and 2-letter tickers (A, AI, GO, WE, MS) collide
// with English words too often to be useful as gazetteer candidates.
// 3-letter stoplist below catches the most common false positives that
// happen to also be tickers (e.g., "ALL" is a ticker for Allstate).
const BARE_TICKER_RE = /\b[A-Z]{3,5}\b/g;
export const KNOWN_TICKERS: ReadonlySet<string> = new Set(knownTickersJson as string[]);
const BARE_TICKER_STOPLIST: ReadonlySet<string> = new Set([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'CAD',
  'CHF',
  'AUD',
  'NZD',
  'HKD',
  'BTC',
  'ETH',
  'CEO',
  'CFO',
  'CTO',
  'COO',
  'CIO',
  'USA',
  'UK',
  'EU',
  'UN',
  'ETF',
  'AI',
  'ML',
  'API',
  'SDK',
  'GPU',
  'CPU',
  'TPU',
  'RAM',
  'SSD',
  // Tech acronyms that happen to be real tickers (AGI=Alamos Gold,
  // GPT=Q3 Realty, etc.) but always read as the acronym in our event
  // text, not the instrument.
  'AGI',
  'GPT',
  'LLM',
  'RAG',
  'VR',
  'AR',
  'XR',
  'IDE',
  'OS',
  'UI',
  'UX',
  'FAQ',
  'DEI',
  'ESG',
  'KYC',
  'AML',
  'PII',
  'GDPR',
  'SAAS',
  'IAAS',
  'PAAS',
  'ALL',
  'AND',
  'ANY',
  'ARE',
  'BUT',
  'FOR',
  'GET',
  'HAS',
  'HER',
  'HIS',
  'HOW',
  'ITS',
  'LET',
  'NEW',
  'NOT',
  'NOW',
  'OFF',
  'ONE',
  'OUR',
  'OUT',
  'OWN',
  'PUT',
  'SEE',
  'SHE',
  'THE',
  'TWO',
  'WAR',
  'WAS',
  'WAY',
  'WHO',
  'WHY',
  'YES',
  'YOU',
  'BIG',
  'OLD',
  'TOP',
  'END',
  'RUN',
  'HIGH',
  'LOW',
  'OPEN',
  'NEXT',
  'BEST',
  'BACK',
  'DOWN',
  'FREE',
  'FULL',
  'GOOD',
  'HERE',
  'HOME',
  'JUST',
  'LAST',
  'LIKE',
  'LIVE',
  'LONG',
  'MORE',
  'MOST',
  'NEED',
  'NEWS',
  'ONLY',
  'OVER',
  'PLAN',
  'POST',
  'READ',
  'REAL',
  'SAID',
  'SAYS',
  'SEEN',
  'SHOW',
  'STAY',
  'TAKE',
  'THAN',
  'THAT',
  'THEM',
  'THEN',
  'THIS',
  'TIME',
  'VERY',
  'WANT',
  'WELL',
  'WERE',
  'WHAT',
  'WHEN',
  'WILL',
  'WITH',
  'WORK',
  'YEAR',
  'YOUR',
  'ABOUT',
  'AFTER',
  'AGAIN',
  'ALONG',
  'BEING',
  'COULD',
  'EVERY',
  'FIRST',
  'FORTH',
  'FOUND',
  'GIVEN',
  'GOING',
  'HAVING',
  'JUST',
  'LATER',
  'MIGHT',
  'NEVER',
  'OTHER',
  'PLACE',
  'RIGHT',
  'SHALL',
  'SHALL',
  'SHOULD',
  'SINCE',
  'STILL',
  'TAKEN',
  'THESE',
  'THINK',
  'THOSE',
  'THREE',
  'TODAY',
  'UNDER',
  'UNTIL',
  'USING',
  'WHERE',
  'WHICH',
  'WHILE',
  'WORLD',
  'WOULD',
]);

/** Extract distinct $TICKER tokens from a title (and optionally content). */
export function extractTickerTokens(title: string, content?: string | null): string[] {
  const text = `${title} ${content ?? ''}`;
  const matches = text.match(TICKER_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (STOP_TOKENS.has(m)) continue;
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/**
 * Extract bare ticker mentions (no `$` prefix) that are in the known
 * universe and not in the stoplist. These surface as gazetteer
 * candidates of a different kind than `$TICKER` matches — they're
 * tickers the writer didn't bother prefixing, which gets common
 * outside r/wallstreetbets (e.g., "AMZN reports earnings tomorrow").
 */
export function extractBareTickerTokens(
  title: string,
  content?: string | null,
  knownTickers: ReadonlySet<string> = KNOWN_TICKERS,
  stoplist: ReadonlySet<string> = BARE_TICKER_STOPLIST
): string[] {
  const text = `${title} ${content ?? ''}`;
  const matches = text.match(BARE_TICKER_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (stoplist.has(m)) continue;
    if (!knownTickers.has(m)) continue;
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

type TokenExtractor = (title: string, content: string | null) => string[];

/** Aggregate per-token counts + source-set + sample events using a token extractor. */
export function aggregateCandidatesWith(
  events: UnmappedEvent[],
  extract: TokenExtractor,
  maxSamples = 3
): Candidate[] {
  const byToken = new Map<
    string,
    { count: number; sources: Set<string>; samples: Candidate['samples'] }
  >();
  for (const ev of events) {
    const title = ev.title ?? '';
    const tokens = extract(title, ev.content);
    for (const token of tokens) {
      let entry = byToken.get(token);
      if (!entry) {
        entry = { count: 0, sources: new Set(), samples: [] };
        byToken.set(token, entry);
      }
      entry.count += 1;
      entry.sources.add(ev.source);
      if (entry.samples.length < maxSamples) {
        entry.samples.push({
          title,
          source: ev.source,
          source_url: ev.source_url,
          published_at: ev.published_at,
        });
      }
    }
  }
  return Array.from(byToken.entries())
    .map(([token, info]) => ({
      token,
      count: info.count,
      sources: Array.from(info.sources).sort(),
      samples: info.samples,
    }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
}

/** Original $TICKER aggregator — preserved as a named export for callers/tests. */
export function aggregateCandidates(events: UnmappedEvent[], maxSamples = 3): Candidate[] {
  return aggregateCandidatesWith(events, extractTickerTokens, maxSamples);
}

/** Bare-ticker aggregator — UPPERCASE 3-5 char tokens in the equities universe. */
export function aggregateBareTickerCandidates(
  events: UnmappedEvent[],
  maxSamples = 3
): Candidate[] {
  return aggregateCandidatesWith(events, (t, c) => extractBareTickerTokens(t, c), maxSamples);
}

// ─── Bare-entity detection ───────────────────────────────────────────────
//
// Catches capitalized proper-noun mentions that aren't in the gazetteer
// yet — the canonical use case is private companies that don't have a
// ticker at all ("Anthropic raises $5B"). Open-world detection so it
// will produce false positives; we lean on a heavy stoplist + the
// frequency × source-diversity filter at the aggregation step to keep
// the signal-to-noise tolerable.
//
// Match shape: 1-3 capitalized words, each ≥3 chars (so "AI"/"ML" etc
// don't pull in noise on their own — those only count when chained to
// a leading capitalized word like "Mistral AI"). Suffixes like Inc/Corp
// are stripped so "Anthropic PBC" and "Anthropic" collapse to one key.

const ENTITY_RE = /\b[A-Z][a-zA-Z0-9]{2,}(?:\s+(?:[A-Z][a-zA-Z0-9]+|AI|ML|XR|VR|AR))*/g;

const ENTITY_SUFFIX_RE =
  /\s+(?:Inc|Corp|Corporation|Ltd|LLC|Co|PBC|Limited|Holdings|Group|Plc|SA|AG|GmbH|NV|BV)\.?$/;

// Words that get stripped if they're the first token of a captured
// phrase — title-case headlines and prediction-market questions
// constantly start with these and we don't want the regex match
// "Will Harvey Weinstein" to count as one entity called "Will Harvey
// Weinstein". After stripping, we re-evaluate against the main
// stoplist below.
const ENTITY_LEADING_STOPWORDS_LOWER: ReadonlySet<string> = new Set([
  'will',
  'would',
  'could',
  'should',
  'shall',
  'may',
  'might',
  'can',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
  'today',
  'tomorrow',
  'yesterday',
]);

// Hand-curated stoplist — common capitalized tokens that aren't proper
// nouns of interest. Kept lowercase for case-insensitive comparison.
const ENTITY_STOPLIST_LOWER: ReadonlySet<string> = new Set([
  // Sentence-starting function words
  'the',
  'this',
  'that',
  'these',
  'those',
  'there',
  'what',
  'when',
  'where',
  'who',
  'why',
  'how',
  'which',
  'and',
  'but',
  'for',
  'from',
  'with',
  'without',
  'into',
  'onto',
  'over',
  'after',
  'before',
  'during',
  'between',
  'among',
  'his',
  'her',
  'their',
  'its',
  'our',
  'your',
  'you',
  'they',
  'she',
  'all',
  'any',
  'every',
  'some',
  'none',
  'new',
  'old',
  'now',
  'today',
  'yesterday',
  'tomorrow',
  'soon',
  'later',
  'more',
  'most',
  'less',
  'least',
  'much',
  'many',
  'few',
  'good',
  'bad',
  'best',
  'worst',
  'great',
  'high',
  'low',
  'huge',
  'big',
  // Yes/No (prediction-market answer values)
  'yes',
  'no',
  'maybe',
  // Common headline words
  'breaking',
  'exclusive',
  'update',
  'report',
  'review',
  'analysis',
  'deep',
  'dive',
  'explained',
  'explainer',
  'stock',
  'stocks',
  'market',
  'markets',
  'earnings',
  'revenue',
  'company',
  'companies',
  'startup',
  'startups',
  'founder',
  'founders',
  'ceo',
  'cfo',
  'cto',
  'president',
  'investor',
  'investors',
  'round',
  'funding',
  'raise',
  'valuation',
  'ipo',
  'acquisition',
  // Generic tech / AI nouns capitalized
  'ai',
  'ml',
  'api',
  'sdk',
  'gpu',
  'cpu',
  'tpu',
  'llm',
  'llms',
  'agi',
  'asi',
  'gpt',
  'rag',
  'vr',
  'ar',
  'xr',
  'agent',
  'agents',
  'model',
  'models',
  'chip',
  'chips',
  'robot',
  'robots',
  'compute',
  'training',
  'inference',
  'fine-tuning',
  // Politics descriptors that aren't entities on their own
  'democratic',
  'republican',
  'democrat',
  'democrats',
  'republicans',
  'liberal',
  'conservative',
  'progressive',
  // Time / day / month
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  // Geography — country names + a few major regions. Country list is
  // intentionally wide because predictive surface dominates with
  // geopolitics events; the gazetteer is AI/tech focused so country
  // names are pure noise for promotion candidates.
  'united states',
  'us',
  'usa',
  'america',
  'american',
  'americans',
  'china',
  'chinese',
  'india',
  'indian',
  'japan',
  'japanese',
  'korea',
  'korean',
  'south korea',
  'north korea',
  'europe',
  'european',
  'uk',
  'britain',
  'british',
  'england',
  'scotland',
  'ireland',
  'germany',
  'german',
  'france',
  'french',
  'russia',
  'russian',
  'iran',
  'iranian',
  'israel',
  'israeli',
  'palestine',
  'palestinian',
  'ukraine',
  'ukrainian',
  'taiwan',
  'taiwanese',
  'australia',
  'australian',
  'mexico',
  'mexican',
  'brazil',
  'brazilian',
  'argentina',
  'canada',
  'canadian',
  'italy',
  'italian',
  'spain',
  'spanish',
  'netherlands',
  'dutch',
  'sweden',
  'swedish',
  'norway',
  'norwegian',
  'denmark',
  'danish',
  'finland',
  'finnish',
  'switzerland',
  'swiss',
  'austria',
  'austrian',
  'belgium',
  'belgian',
  'greece',
  'greek',
  'turkey',
  'turkish',
  'egypt',
  'egyptian',
  'saudi arabia',
  'uae',
  'dubai',
  'qatar',
  'kuwait',
  'vietnam',
  'vietnamese',
  'thailand',
  'thai',
  'malaysia',
  'malaysian',
  'indonesia',
  'indonesian',
  'philippines',
  'filipino',
  'singapore',
  'hong kong',
  'new zealand',
  'pakistan',
  'pakistani',
  'bangladesh',
  'venezuela',
  'colombia',
  'chile',
  'africa',
  'asia',
  'middle east',
  'south america',
  'south asia',
  'latin america',
  'california',
  'new york',
  'san francisco',
  'silicon valley',
  'boston',
  'los angeles',
  'chicago',
  'seattle',
  'austin',
  'denver',
  'london',
  'paris',
  'berlin',
  'tokyo',
  'beijing',
  'shanghai',
  'moscow',
  'hormuz',
  'strait',
  'strait of hormuz',
  // High-volume publishers / news brands often appearing as capitalized
  'reuters',
  'bloomberg',
  'wsj',
  'ft',
  'cnbc',
  'bbc',
  'cnn',
  'nyt',
  'techcrunch',
  'the verge',
  'ars technica',
  'the information',
  // Market platforms — these appear *in* event titles but they're the
  // source surface, never the subject we'd map. (`polymarket` /
  // `manifold` show up because Manifold question titles often
  // reference each other.)
  'polymarket',
  'manifold',
  'kalshi',
  'betfair',
  'predictit',
  // Currency / units that slip into bare-entity capture
  'usd',
  'eur',
  'gbp',
  'jpy',
  'cny',
  // Misc title fragments
  'interview',
  'video',
  'podcast',
  'newsletter',
  'live',
  'live blog',
  'live update',
]);

/** Build a Set of already-mapped names + aliases (lowercase) from seed entities. */
function buildSeededLookup(): Set<string> {
  const out = new Set<string>();
  for (const entity of seedEntities as Array<{
    name?: string | null;
    ticker?: string | null;
    aliases?: string | null;
  }>) {
    if (entity.name) {
      const trimmed = entity.name.toLowerCase().replace(ENTITY_SUFFIX_RE, '').trim();
      out.add(entity.name.toLowerCase());
      if (trimmed && trimmed !== entity.name.toLowerCase()) out.add(trimmed);
    }
    if (entity.ticker) out.add(entity.ticker.toLowerCase());
    if (entity.aliases) {
      for (const alias of entity.aliases.split('|')) {
        const a = alias.trim().toLowerCase();
        if (a) out.add(a);
      }
    }
  }
  return out;
}

export const SEEDED_ENTITY_LOOKUP: ReadonlySet<string> = buildSeededLookup();

/** Strip company-form suffixes so "Anthropic PBC" and "Anthropic" hash the same. */
export function normalizeEntityCandidate(raw: string): string {
  return raw.replace(ENTITY_SUFFIX_RE, '').trim();
}

/** Strip leading question/auxiliary words ("Will Harvey Weinstein" → "Harvey Weinstein"). */
function stripLeadingStopwords(phrase: string, leading: ReadonlySet<string>): string {
  const tokens = phrase.split(/\s+/);
  let i = 0;
  while (i < tokens.length && leading.has(tokens[i].toLowerCase())) {
    i += 1;
  }
  return tokens.slice(i).join(' ');
}

export function extractEntityCandidates(
  title: string,
  content?: string | null,
  seeded: ReadonlySet<string> = SEEDED_ENTITY_LOOKUP,
  stoplist: ReadonlySet<string> = ENTITY_STOPLIST_LOWER,
  leadingStopwords: ReadonlySet<string> = ENTITY_LEADING_STOPWORDS_LOWER
): string[] {
  const text = `${title} ${content ?? ''}`;
  const matches = text.match(ENTITY_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const stripped = stripLeadingStopwords(raw, leadingStopwords);
    const normalized = normalizeEntityCandidate(stripped);
    if (normalized.length < 3) continue;
    const lower = normalized.toLowerCase();
    if (stoplist.has(lower)) continue;
    if (seeded.has(lower)) continue;
    // Single-token candidate must start with a capital — protects
    // against the leading stop-word stripping leaving us with a
    // lowercase orphan (we shouldn't surface "harvey" as a candidate).
    if (!/^[A-Z]/.test(normalized)) continue;
    // Standalone short all-caps tokens are almost always acronyms
    // (EOY, SAT, WTI, ARC). Real instruments get picked up on the
    // bare-ticker path; real multi-word entities like "FIFA World
    // Cup" keep their space-separated form and pass this filter.
    if (!/\s/.test(normalized) && /^[A-Z0-9]+$/.test(normalized) && normalized.length <= 5) {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Bare-entity aggregator. Filters singletons (count<2 and sources<2). */
export function aggregateEntityCandidates(events: UnmappedEvent[], maxSamples = 3): Candidate[] {
  const aggregated = aggregateCandidatesWith(
    events,
    (t, c) => extractEntityCandidates(t, c),
    maxSamples
  );
  // Open-world detection has a noisier base rate than the closed-world
  // $TICKER / known-ticker paths, so require either repeated mentions
  // or multi-source presence before surfacing a candidate.
  return aggregated.filter((c) => c.count >= 2 || c.sources.length >= 2);
}

export const unmappedRoute = new Hono<{ Bindings: Env }>();

unmappedRoute.get('/', async (c) => {
  const hours = Math.min(Math.max(Number(c.req.query('hours') ?? 24), 1), 24 * 30);
  const eventLimit = Math.min(Math.max(Number(c.req.query('limit') ?? 500), 1), 2000);
  const candidateLimit = Math.min(Math.max(Number(c.req.query('top') ?? 30), 1), 200);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const events =
    (
      await c.env.DB.prepare(
        `SELECT title, content, source, source_url, published_at
     FROM events
     WHERE primary_entity_id IS NULL
       AND title IS NOT NULL
       AND published_at >= ?
     ORDER BY published_at DESC
     LIMIT ?`
      )
        .bind(since, eventLimit)
        .all<UnmappedEvent>()
    ).results ?? [];

  const candidates = aggregateCandidates(events).slice(0, candidateLimit);
  const bareTickerCandidates = aggregateBareTickerCandidates(events).slice(0, candidateLimit);
  const entityCandidates = aggregateEntityCandidates(events).slice(0, candidateLimit);

  console.log(
    JSON.stringify({
      route: '/unmapped',
      hours,
      eventsScanned: events.length,
      candidates: candidates.length,
      bareTickerCandidates: bareTickerCandidates.length,
      entityCandidates: entityCandidates.length,
      topToken: candidates[0]?.token ?? null,
      topBareTicker: bareTickerCandidates[0]?.token ?? null,
      topEntity: entityCandidates[0]?.token ?? null,
    })
  );

  return c.json({
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    eventsScanned: events.length,
    candidates,
    bareTickerCandidates,
    entityCandidates,
  });
});
