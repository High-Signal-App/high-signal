// Default to deployed prod API. Override at build time with NEXT_PUBLIC_API_BASE for local dev.
import type {
  BriefSnapshot,
  BriefFeedEdition,
  BriefFeedCadence,
  BriefFeedSlug,
  CommunityDigestSnapshot,
  Region,
} from '@high-signal/shared';
import type { SignalContentCategory, SignalQualityBand, SourceClass } from '@high-signal/shared';
import type {
  ClaimRecord as ClaimRecordJson,
  ClaimEvidenceLink as ClaimEvidenceLinkJson,
  ClaimTimelineEvent as ClaimTimelineEventJson,
  EvidenceRollup as ClaimRollupJson,
} from '@high-signal/shared';

export type {
  ClaimRecord as ClaimRecordJson,
  ClaimEvidenceLink as ClaimEvidenceLinkJson,
  ClaimTimelineEvent as ClaimTimelineEventJson,
  EvidenceRollup as ClaimRollupJson,
} from '@high-signal/shared';

export type {
  AgentEvaluationAudit,
  AgentEvaluationAuditDetail,
  AgentEvaluationCompetitor,
  BriefSnapshot,
  BriefFeedEdition,
  BriefFeedCadence,
  BriefFeedSlug,
  CommunityDigestSnapshot,
  Region,
  TrackedCommunity,
} from '@high-signal/shared';

const API_BASE =
  process.env['NEXT_PUBLIC_API_BASE'] ?? 'https://high-signal-api.sarthakagrawal927.workers.dev';

// Service binding when running inside the high-signal-web Worker (avoids CF
// "fetch loop" guard that blocks workers.dev → workers.dev fetches in the same
// account). Resolved lazily so it works in both Worker SSR and `next dev`.
async function getBinding(): Promise<{ fetch: typeof fetch } | null> {
  if (typeof process === 'undefined') return null;
  try {
    const mod = await import('@opennextjs/cloudflare');
    const ctx = (
      mod as unknown as {
        getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
      }
    ).getCloudflareContext?.();
    const api = ctx?.env?.['API'];
    if (api && typeof (api as { fetch?: unknown }).fetch === 'function') {
      return api as { fetch: typeof fetch };
    }
  } catch {
    /* not in Worker context */
  }
  return null;
}

export async function fetchApiResponse(path: string, init?: RequestInit): Promise<Response> {
  const binding = await getBinding();
  if (binding) {
    return binding.fetch(`https://api${path}`, init);
  }
  return fetch(`${API_BASE}${path}`, { ...init, cache: 'no-store' });
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetchApiResponse(path, init);
  if (!r.ok) throw new Error(`api ${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export type Direction = 'up' | 'down' | 'neutral';
export type Confidence = 'low' | 'medium' | 'high';
export type Outcome = 'hit' | 'miss' | 'push' | 'pending';

export interface SignalRow {
  id: string;
  slug: string;
  signalType: string;
  primaryEntityId: string;
  direction: Direction;
  confidence: Confidence;
  predictedWindowDays: number;
  publishedAt: number;
  evidenceUrls: string[];
  spilloverEntityIds: string[];
  reviewStatus: 'draft' | 'published' | 'corrected' | 'killed';
  bodyMd: string;
  contentCategory?: SignalContentCategory;
  qualityScore?: number;
  qualityBand?: SignalQualityBand;
  publishable?: boolean;
  sourceClasses?: SourceClass[];
  independentSourceCount?: number;
  qualityReasons?: string[];
}

export interface EntityRow {
  id: string;
  ticker: string | null;
  name: string;
  type: 'public' | 'private' | 'sector' | 'product';
  country: string | null;
  sector: string | null;
}

export interface MarketQuote {
  id: string;
  source: 'polymarket' | 'manifold' | 'kalshi';
  marketId: string;
  entityId: string | null;
  question: string;
  outcome: 'yes' | 'no' | 'binary';
  prob: number;
  volume: number | null;
  resolved: boolean;
  resolvedOutcome: string | null;
  fetchedAt: string;
  marketUrl: string;
}

export interface RelationshipRow {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: 'supplier' | 'customer' | 'peer' | 'subsidiary' | 'partner' | 'competitor';
  weight: number;
  verified: boolean;
}

export interface RedditCommunity {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  activeUsers: number | null;
  createdAt: string;
  nsfw: boolean;
  url: string;
}

export interface RedditMention {
  id: string;
  title: string | null;
  selftext: string | null;
  author: string;
  subreddit: string;
  score: number;
  comments: number;
  url: string;
  permalink: string;
  type: 'post' | 'comment';
  body: string | null;
  createdAt: string;
}

export interface TrackBucket {
  signalType: string;
  hit: number;
  miss: number;
  push: number;
  pending: number;
  total: number;
  hitRate: number | null;
}

export interface SourceAccuracyBucket {
  sourceType: string;
  hit: number;
  miss: number;
  push: number;
  total: number;
  hitRate: number | null;
}

export interface BacktestWorkbenchExample {
  id: string;
  slug: string;
  title: string | null;
  signalType: string;
  direction: Direction;
  confidence: Confidence;
  predictedWindowDays: number;
  publishedAt: number;
  evidenceCount: number;
  outcome: Outcome;
  forwardReturn: number | null;
  windowDays: number;
  isBackfill: number;
  actionScore: number | null;
  actionBand: 'compound' | 'usable' | 'watch' | 'retire' | 'pending';
}

export interface BacktestWorkbenchBucket {
  signalType: string;
  count: number;
  matured: number;
  pending: number;
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number | null;
  avgActionScore: number | null;
  evidenceReadyRate: number;
  recommendedAction: 'promote' | 'keep-testing' | 'tighten-thesis' | 'retire-or-rewrite';
  examples: BacktestWorkbenchExample[];
}

export interface BacktestWorkbench {
  cohort: 'all' | 'live' | 'backfill';
  summary: {
    signals: number;
    matured: number;
    pending: number;
    avgActionScore: number | null;
    evidenceReadyRate: number;
    promoteTypes: number;
    rewriteTypes: number;
  };
  buckets: BacktestWorkbenchBucket[];
  examples: BacktestWorkbenchExample[];
}

export interface SignalFilters {
  type?: string;
  category?: SignalContentCategory;
  direction?: Direction;
  confidence?: Confidence;
  entity?: string;
  status?: 'draft' | 'published' | 'corrected' | 'killed';
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
  minQuality?: number;
}

export interface Facets {
  types: { k: string; n: number }[];
  directions: { k: string; n: number }[];
  confidences: { k: string; n: number }[];
  topEntities: { k: string; n: number }[];
  categories?: { k: SignalContentCategory; n: number }[];
  sourceClasses?: { k: SourceClass; n: number }[];
}

function qs(o: SignalFilters): string {
  const e = Object.entries(o)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return e.length ? `?${new URLSearchParams(e as [string, string][]).toString()}` : '';
}

export interface DataSourceLive {
  id: string;
  count: number;
  lastAt: number;
  samples: Array<{ title: string | null; url: string; publishedAt: number }>;
}
export interface DataSourcesResponse {
  sources: DataSourceLive[];
  total: number;
  available: boolean;
}
export interface DataSourceEvent {
  title: string | null;
  content: string | null;
  url: string;
  source: string;
  entity: string | null;
  publishedAt: number;
}
export interface DataSourceEventsResponse {
  id: string;
  date?: string;
  total: number;
  events: DataSourceEvent[];
  hasMore: boolean;
  available: boolean;
}

export interface IntentOpportunity {
  id: string;
  brandId: string;
  ownerId: string;
  source: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceExcerpt: string;
  platform: string;
  intentStage:
    | 'awareness'
    | 'pain'
    | 'comparison'
    | 'purchase'
    | 'proof'
    | 'integration'
    | 'content';
  actionType:
    | 'watch'
    | 'reply'
    | 'create_proof'
    | 'improve_docs'
    | 'add_integration'
    | 'write_comparison'
    | 'content_opportunity';
  score: number;
  competitors: string[];
  matchedKeywords: string[];
  evidenceTaskId: string | null;
  replyDraft: string | null;
  status: 'open' | 'dismissed' | 'done';
  foundAt: string;
  updatedAt: string;
}

export const api = {
  signals: (f: SignalFilters = {}) => fetchJson<{ signals: SignalRow[] }>(`/signals${qs(f)}`),
  dataSources: () => fetchJson<DataSourcesResponse>('/data/sources'),
  dataSourceEvents: (id: string, opts: { limit?: number; offset?: number; date?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.limit != null) p.set('limit', String(opts.limit));
    if (opts.offset != null) p.set('offset', String(opts.offset));
    if (opts.date) p.set('date', opts.date);
    const q = p.toString();
    return fetchJson<DataSourceEventsResponse>(
      `/data/sources/${encodeURIComponent(id)}${q ? `?${q}` : ''}`
    );
  },
  facets: () => fetchJson<Facets>('/signals/facets'),
  signal: (slug: string) =>
    fetchJson<{
      signal: SignalRow;
      evidence: Array<{
        id: string;
        url: string;
        sourceType: string;
        excerpt: string | null;
        publishedAt?: number | string | null;
      }>;
      scores: Array<{
        id: string;
        outcome: Outcome;
        windowDays: number;
        forwardReturn: number | null;
      }>;
    }>(`/signals/${slug}`),
  claimsBySignal: (slug: string) =>
    fetchJson<{
      claims: Array<
        ClaimRecordJson & {
          evidence: ClaimEvidenceLinkJson[];
          rollup: ClaimRollupJson;
        }
      >;
    }>(`/claims/by-signal/${slug}`),
  claim: (id: string) =>
    fetchJson<{
      claim: ClaimRecordJson & {
        evidence: ClaimEvidenceLinkJson[];
        timeline: ClaimTimelineEventJson[];
      };
      rollup: ClaimRollupJson;
    }>(`/claims/${id}`),
  entities: () => fetchJson<{ entities: EntityRow[] }>('/entities'),
  entity: (id: string) =>
    fetchJson<{
      entity: EntityRow;
      relationships: RelationshipRow[];
      signals: SignalRow[];
      marketQuotes?: MarketQuote[];
    }>(`/entities/${id}`),
  trackRecord: () => fetchJson<{ buckets: TrackBucket[] }>('/track-record'),
  trackRecordLabels: () =>
    fetchJson<{
      generatedAt: string;
      backtestDays: number;
      labels: Record<
        'breakout' | 'divergence',
        { n: number; hits: number; rate: number; lift: number | null }
      >;
      unlabeled: { n: number; hits: number; rate: number };
      baseline: { n: number; hits: number; rate: number };
    }>('/track-record/labels'),
  trackRecordCohorts: () =>
    fetchJson<{ live: TrackBucket[]; backfill: TrackBucket[]; all: TrackBucket[] }>(
      '/track-record/cohorts'
    ),
  sourceAccuracy: () =>
    fetchJson<{ live: SourceAccuracyBucket[]; backfill: SourceAccuracyBucket[] }>(
      '/track-record/source-accuracy'
    ),
  backtestWorkbench: (cohort: 'all' | 'live' | 'backfill' = 'live') =>
    fetchJson<BacktestWorkbench>(`/track-record/workbench?cohort=${cohort}`),
  sectors: (days = 60) =>
    fetchJson<{
      days: number;
      sectors: Array<{
        sector: string;
        signalCount: number;
        upCount: number;
        downCount: number;
        neutralCount: number;
        netDirection: number;
        topEntities: string[];
        hits: number;
        misses: number;
        pushes: number;
        hitRate: number | null;
      }>;
    }>(`/sectors?days=${days}`),
  convergence: (hours = 24, minSources = 3) =>
    fetchJson<{
      generatedAt: string;
      windowHours: number;
      minSources: number;
      rows: Array<{
        entityId: string;
        name: string | null;
        ticker: string | null;
        sector: string | null;
        sourceCount: number;
        eventCount: number;
        sources: string[];
        latestAt: number;
        earliestAt: number;
        firstSeenEver: number | null;
        isNew: boolean;
        recent: Array<{
          source: string;
          title: string | null;
          source_url: string;
          published_at: number;
        }>;
        marketQuote: {
          source: string;
          marketId: string;
          question: string;
          marketUrl: string;
          probNow: number;
          probPrior: number | null;
          probChange: number | null;
          fetchedAtNow: number;
          fetchedAtPrior: number | null;
        } | null;
        attention: {
          totalViews: number;
          avgPerDay: number;
          trendDirection: 'up' | 'down' | 'flat' | null;
          trendDeltaPct: number | null;
        } | null;
        label: 'breakout' | 'divergence' | null;
        labelReason: string | null;
      }>;
    }>(`/convergence?hours=${hours}&min_sources=${minSources}`),
  enrichTicker: (token: string) =>
    fetchJson<{
      enrichment: {
        ticker: string;
        wikidataId: string | null;
        name: string | null;
        country: string | null;
        industry: string | null;
        exchange: string | null;
        wikiUrl: string | null;
        cik: string | null;
        isin: string | null;
      };
      csvRow: string;
      source: 'wikidata' | 'wikipedia' | 'fallback';
    }>(`/enrich/ticker?token=${encodeURIComponent(token)}`),
  unmapped: (hours = 24, top = 30) =>
    fetchJson<{
      generatedAt: string;
      windowHours: number;
      eventsScanned: number;
      candidates: Array<{
        token: string;
        count: number;
        sources: string[];
        samples: Array<{
          title: string;
          source: string;
          source_url: string;
          published_at: number;
        }>;
      }>;
      bareTickerCandidates: Array<{
        token: string;
        count: number;
        sources: string[];
        samples: Array<{
          title: string;
          source: string;
          source_url: string;
          published_at: number;
        }>;
      }>;
      entityCandidates: Array<{
        token: string;
        count: number;
        sources: string[];
        samples: Array<{
          title: string;
          source: string;
          source_url: string;
          published_at: number;
        }>;
      }>;
    }>(`/unmapped?hours=${hours}&top=${top}`),
  digestWeekly: () => fetchJson<{ since: string; signals: SignalRow[] }>('/digest/weekly'),
  redditCommunity: (subreddit: string) =>
    fetchJson<{ community: RedditCommunity }>(
      `/communities/reddit/${encodeURIComponent(subreddit)}`
    ),
  redditMentions: (query: string, limit = 10) =>
    fetchJson<{ mentions: RedditMention[]; total: number }>(
      `/communities/reddit-mentions?${new URLSearchParams({ q: query, limit: String(limit) })}`
    ),
  productCommunityDiscover: (period: 'day' | 'week' | 'month' = 'week') =>
    fetchJson<{ items: CommunityDigestSnapshot[] }>(
      `/products/communities/discover?${new URLSearchParams({ period })}`
    ),
  productCommunityDigests: (subreddit: string, period: 'day' | 'week' | 'month' = 'week') =>
    fetchJson<{ digests: CommunityDigestSnapshot[] }>(
      `/products/communities/${encodeURIComponent(subreddit)}/${period}/digests`
    ),
  seoAudit: (url: string) =>
    fetchJson<SeoAuditReport>(`/products/agent-eval/seo-audit?${new URLSearchParams({ url })}`),
  brief: (params: { region?: Region; productId?: string; date?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.region) search.set('region', params.region);
    if (params.productId) search.set('product', params.productId);
    if (params.date) search.set('date', params.date);
    const suffix = search.toString();
    return fetchJson<BriefSnapshot>(`/brief/daily${suffix ? `?${suffix}` : ''}`);
  },
  briefFeed: (params: {
    feed: BriefFeedSlug;
    cadence: BriefFeedCadence | string;
    period?: string;
    region?: Region;
  }) => {
    const path = `/brief/feeds/${encodeURIComponent(params.feed)}/${encodeURIComponent(params.cadence)}${
      params.period ? `/${encodeURIComponent(params.period)}` : ''
    }`;
    const search = new URLSearchParams();
    if (params.region) search.set('region', params.region);
    const suffix = search.toString();
    return fetchJson<BriefFeedEdition>(`${path}${suffix ? `?${suffix}` : ''}`);
  },
  briefDates: () =>
    fetchJson<{
      dates: Array<{
        date: string;
        regionCount: number;
        computedAt: string;
        publicItemCount: number;
        citedItemCount: number;
      }>;
    }>('/brief/dates'),
  labFeed: async (
    params: { query?: string; source?: string; limit?: number; byCluster?: boolean } = {}
  ) => {
    const base = process.env['LAB_API_URL'] ?? process.env['NEXT_PUBLIC_LAB_API_URL'];
    if (!base) throw new Error('lab_not_configured');
    const search = new URLSearchParams();
    if (params.query) search.set('q', params.query);
    if (params.source) search.set('source', params.source);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.byCluster) search.set('by_cluster', 'true');
    const suffix = search.toString();
    const r = await fetch(`${base.replace(/\/$/, '')}/feed${suffix ? `?${suffix}` : ''}`, {
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`lab ${r.status}`);
    return (await r.json()) as LabFeedResult;
  },
};

export interface SeoCheckResult {
  key: string;
  title: string;
  axis: 'seo' | 'geo' | 'both';
  status: 'strong' | 'clear' | 'weak' | 'missing';
  notes: string;
  recommendation: string;
}

export interface SeoAuditReport {
  url: string;
  fetchedAt: string;
  finalUrl: string;
  status: number | null;
  score: number;
  seoScore: number;
  geoScore: number;
  band: 'strong' | 'clear' | 'weak' | 'missing';
  checks: SeoCheckResult[];
  evidenceUrls: string[];
  error: string | null;
}

export interface LabFeedItem {
  id: string;
  source: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  score: number;
  clusterId?: string | null;
}

export interface LabFeedStats {
  documents: number;
  sources: number;
  embeddings: number;
  lastIngestAt: string | null;
}

export interface LabFeedResult {
  items: LabFeedItem[];
  stats: LabFeedStats;
}
