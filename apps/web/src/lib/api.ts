// Default to deployed prod API. Override at build time with NEXT_PUBLIC_API_BASE for local dev.
import type {
  AgentEvaluationAudit,
  AgentEvaluationAuditDetail,
  AgentEvaluationCompetitor,
  AIPlatform,
  BriefSnapshot,
  CommunityDigestSnapshot,
  MentionBrandConfig,
  MentionCheck,
  MentionPrompt,
  ProductDashboardSnapshot,
  Region,
  TrackedCommunity,
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
  AIPlatform,
  BriefSnapshot,
  CommunityDigestSnapshot,
  MentionBrandConfig,
  MentionCheck,
  MentionPrompt,
  ProductDashboardSnapshot,
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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const binding = await getBinding();
  let r: Response;
  if (binding) {
    r = await binding.fetch(`https://api${path}`, init);
  } else {
    r = await fetch(`${API_BASE}${path}`, { ...init, cache: 'no-store' });
  }
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
  dataSourceEvents: (id: string, opts: { limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.limit != null) p.set('limit', String(opts.limit));
    if (opts.offset != null) p.set('offset', String(opts.offset));
    const q = p.toString();
    return fetchJson<DataSourceEventsResponse>(
      `/data/sources/${encodeURIComponent(id)}${q ? `?${q}` : ''}`
    );
  },
  facets: () => fetchJson<Facets>('/signals/facets'),
  signal: (slug: string) =>
    fetchJson<{
      signal: SignalRow;
      evidence: Array<{ id: string; url: string; sourceType: string; excerpt: string | null }>;
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
  productDashboard: (ownerId: string) =>
    fetchJson<ProductDashboardSnapshot>(
      `/products/dashboard?${new URLSearchParams({ owner: ownerId })}`
    ),
  productCommunityDiscover: (period: 'day' | 'week' | 'month' = 'week') =>
    fetchJson<{ items: CommunityDigestSnapshot[] }>(
      `/products/communities/discover?${new URLSearchParams({ period })}`
    ),
  productCommunityDigests: (subreddit: string, period: 'day' | 'week' | 'month' = 'week') =>
    fetchJson<{ digests: CommunityDigestSnapshot[] }>(
      `/products/communities/${encodeURIComponent(subreddit)}/${period}/digests`
    ),
  agentEvaluationAudits: (ownerId: string, limit = 10) =>
    fetchJson<{ audits: AgentEvaluationAudit[] }>(
      `/products/agent-eval/audits?${new URLSearchParams({ owner: ownerId, limit: String(limit) })}`
    ),
  createAgentEvaluationAudit: (
    ownerId: string,
    input: {
      brandName: string;
      brandUrl: string;
      buyerMission: string;
      targetSegment?: string | null;
      competitors?: AgentEvaluationCompetitor[];
      evidenceText?: string | null;
      evidenceUrls?: string[];
    }
  ) =>
    fetchJson<AgentEvaluationAuditDetail>(
      `/products/agent-eval/audits?${new URLSearchParams({ owner: ownerId })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
  agentEvaluationAudit: (ownerId: string, id: string) =>
    fetchJson<AgentEvaluationAuditDetail>(
      `/products/agent-eval/audits/${encodeURIComponent(id)}?${new URLSearchParams({ owner: ownerId })}`
    ),
  seoAudit: (url: string) =>
    fetchJson<SeoAuditReport>(`/products/agent-eval/seo-audit?${new URLSearchParams({ url })}`),
  trackedCommunities: (ownerId: string) =>
    fetchJson<{ communities: TrackedCommunity[] }>(
      `/products/communities/tracked?${new URLSearchParams({ owner: ownerId })}`
    ),
  createTrackedCommunity: (
    ownerId: string,
    input: {
      subreddit: string;
      prompt?: string | null;
      period?: 'day' | 'week' | 'month';
      isPublic?: boolean;
    }
  ) =>
    fetchJson<{ community: TrackedCommunity }>(
      `/products/communities/tracked?${new URLSearchParams({ owner: ownerId })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
  deleteTrackedCommunity: (ownerId: string, id: string) =>
    fetchJson<{ ok: true }>(
      `/products/communities/tracked/${encodeURIComponent(id)}?${new URLSearchParams({ owner: ownerId })}`,
      { method: 'DELETE' }
    ),
  generateCommunityDigest: (ownerId: string, id: string) =>
    fetchJson<{ digest: CommunityDigestSnapshot }>(
      `/products/communities/tracked/${encodeURIComponent(id)}/digests?${new URLSearchParams({ owner: ownerId })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    ),
  mentionConfigs: (ownerId: string) =>
    fetchJson<{ configs: MentionBrandConfig[] }>(
      `/products/mentions/configs?${new URLSearchParams({ owner: ownerId })}`
    ),
  visibilityMatrix: (ownerId: string, brandId: string, window = 30) =>
    fetchJson<{
      cells: Array<{
        prompt: string;
        platform: string;
        brandMentioned: boolean;
        brandRecommended: boolean;
        competitors: string[];
        citationsCount: number;
        runAt: string;
      }>;
      windowDays: number;
      runs: number;
    }>(
      `/products/mentions/${encodeURIComponent(brandId)}/visibility-matrix?window=${window}&owner=${encodeURIComponent(ownerId)}`
    ),
  shareOfVoice: (ownerId: string, brandId: string, window = 30) =>
    fetchJson<{
      windowDays: number;
      runs: number;
      brandMentionRate: number;
      brandRecommendationRate: number;
      brandCitationRate: number;
      competitorShare: Record<string, number>;
      citationShare: Record<string, number>;
    }>(
      `/products/mentions/${encodeURIComponent(brandId)}/share-of-voice?window=${window}&owner=${encodeURIComponent(ownerId)}`
    ),
  citedSources: (ownerId: string, brandId: string, ownership?: string) =>
    fetchJson<{
      sources: Array<{
        id: string;
        url: string;
        host: string;
        ownership: 'owned' | 'competitor' | 'third_party' | 'unknown';
        competitorId: string | null;
        firstSeenAt: string;
        lastSeenAt: string;
        platforms: string[];
        mentionRunCount: number;
      }>;
    }>(
      `/products/mentions/${encodeURIComponent(brandId)}/cited-sources?owner=${encodeURIComponent(ownerId)}${ownership ? `&ownership=${ownership}` : ''}`
    ),
  intentOpportunities: (
    ownerId: string,
    brandId: string,
    opts: { status?: 'open' | 'dismissed' | 'done'; source?: string; limit?: number } = {}
  ) => {
    const params = new URLSearchParams({ owner: ownerId });
    if (opts.status) params.set('status', opts.status);
    if (opts.source) params.set('source', opts.source);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    return fetchJson<{ opportunities: IntentOpportunity[]; status: string }>(
      `/products/mentions/${encodeURIComponent(brandId)}/intent-opportunities?${params}`
    );
  },
  refreshIntentOpportunities: (ownerId: string, brandId: string, window = 14) =>
    fetchJson<{ upserts: number; scanned: number; windowDays: number }>(
      `/products/mentions/${encodeURIComponent(brandId)}/intent-opportunities/refresh?window=${window}&owner=${encodeURIComponent(ownerId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    ),
  updateIntentOpportunity: (
    ownerId: string,
    brandId: string,
    id: string,
    status: 'open' | 'dismissed' | 'done'
  ) =>
    fetchJson<{ opportunity: IntentOpportunity }>(
      `/products/mentions/${encodeURIComponent(brandId)}/intent-opportunities/${encodeURIComponent(id)}?owner=${encodeURIComponent(ownerId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }
    ),
  generateIntentReplyDraft: (ownerId: string, brandId: string, id: string) =>
    fetchJson<{ opportunity: IntentOpportunity }>(
      `/products/mentions/${encodeURIComponent(brandId)}/intent-opportunities/${encodeURIComponent(id)}/reply-draft?owner=${encodeURIComponent(ownerId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    ),
  mentionTrends: (ownerId: string, brandId: string, window = 30) =>
    fetchJson<{
      points: Array<{
        date: string;
        runs: number;
        mentionRate: number;
        recommendationRate: number;
        citedHosts: number;
      }>;
    }>(
      `/products/mentions/${encodeURIComponent(brandId)}/trends?window=${window}&owner=${encodeURIComponent(ownerId)}`
    ),
  mentionReport: (ownerId: string, brandId: string, window = 30) =>
    fetchJson<{
      windowDays: number;
      summary: {
        runs: number;
        brandMentionRate: number;
        brandCitationRate: number;
        trendPoints: number;
      };
      matrix: Array<{
        prompt: string;
        platform: string;
        brandMentioned: boolean;
        brandRecommended: boolean;
        competitors: string[];
        citationsCount: number;
        runAt: string;
      }>;
      shareOfVoice: {
        windowDays: number;
        runs: number;
        brandMentionRate: number;
        brandRecommendationRate: number;
        brandCitationRate: number;
        competitorShare: Record<string, number>;
        citationShare: Record<string, number>;
      };
      citedSources: Array<{
        id: string;
        url: string;
        host: string;
        ownership: string;
        mentionRunCount: number;
      }>;
      intentOpportunities: IntentOpportunity[];
    }>(
      `/products/mentions/${encodeURIComponent(brandId)}/report?window=${window}&owner=${encodeURIComponent(ownerId)}`
    ),
  agentEvalAttributes: (ownerId: string, auditId: string) =>
    fetchJson<{
      attributes: Array<{
        area: string;
        status: 'missing' | 'weak' | 'clear' | 'strong';
        evidenceUrls: string[];
        notes: string;
        taskCount: number;
      }>;
    }>(
      `/products/agent-eval/${encodeURIComponent(auditId)}/attributes?owner=${encodeURIComponent(ownerId)}`
    ),
  createMentionConfig: (
    ownerId: string,
    input: {
      brandName: string;
      brandAliases?: string[];
      brandUrl?: string | null;
      competitors?: Array<{ name: string; url?: string }>;
      platforms?: AIPlatform[];
      aiEndpointUrl?: string | null;
      aiModel?: string | null;
      checkSchedule?: 'daily' | 'weekly' | null;
      badgeEnabled?: boolean;
    }
  ) =>
    fetchJson<{ config: MentionBrandConfig }>(
      `/products/mentions/configs?${new URLSearchParams({ owner: ownerId })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
  deleteMentionConfig: (ownerId: string, id: string) =>
    fetchJson<{ ok: true }>(
      `/products/mentions/configs/${encodeURIComponent(id)}?${new URLSearchParams({ owner: ownerId })}`,
      { method: 'DELETE' }
    ),
  mentionConfigPrompts: (ownerId: string, configId: string) =>
    fetchJson<{ prompts: MentionPrompt[] }>(
      `/products/mentions/configs/${encodeURIComponent(configId)}/prompts?${new URLSearchParams({ owner: ownerId })}`
    ),
  createMentionPrompt: (
    ownerId: string,
    configId: string,
    input: { promptText: string; category?: string | null }
  ) =>
    fetchJson<{ prompt: MentionPrompt }>(
      `/products/mentions/configs/${encodeURIComponent(configId)}/prompts?${new URLSearchParams({ owner: ownerId })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
  mentionConfigChecks: (ownerId: string, configId: string) =>
    fetchJson<{ checks: MentionCheck[] }>(
      `/products/mentions/configs/${encodeURIComponent(configId)}/checks?${new URLSearchParams({ owner: ownerId })}`
    ),
  runMentionCheck: (ownerId: string, configId: string) =>
    fetchJson<{ check: MentionCheck }>(
      `/products/mentions/configs/${encodeURIComponent(configId)}/checks?${new URLSearchParams({ owner: ownerId })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    ),
  brief: (params: { region?: Region; ownerId?: string; productId?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.region) search.set('region', params.region);
    if (params.ownerId) search.set('owner', params.ownerId);
    if (params.productId) search.set('product', params.productId);
    const suffix = search.toString();
    return fetchJson<BriefSnapshot>(`/brief/daily${suffix ? `?${suffix}` : ''}`);
  },
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
