import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    ticker: text('ticker'),
    name: text('name').notNull(),
    type: text('type', { enum: ['public', 'private', 'sector', 'product'] }).notNull(),
    country: text('country'),
    sector: text('sector'),
    metadata: text('metadata', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('entities_ticker_idx').on(t.ticker), index('entities_sector_idx').on(t.sector)]
);

export const relationships = sqliteTable(
  'relationships',
  {
    id: text('id').primaryKey(),
    fromEntityId: text('from_entity_id')
      .notNull()
      .references(() => entities.id),
    toEntityId: text('to_entity_id')
      .notNull()
      .references(() => entities.id),
    type: text('type', {
      enum: ['supplier', 'customer', 'peer', 'subsidiary', 'partner', 'competitor'],
    }).notNull(),
    weight: real('weight').default(1.0),
    verified: integer('verified', { mode: 'boolean' }).default(false),
    evidenceUrl: text('evidence_url'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('relationships_from_idx').on(t.fromEntityId),
    index('relationships_to_idx').on(t.toEntityId),
    uniqueIndex('relationships_unique').on(t.fromEntityId, t.toEntityId, t.type),
  ]
);

export const sourceDocuments = sqliteTable(
  'source_documents',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    documentKey: text('document_key').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    rawHash: text('raw_hash').notNull(),
    rawText: text('raw_text'),
    rawJson: text('raw_json', { mode: 'json' }),
    parsedFields: text('parsed_fields', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('source_documents_document_key_idx').on(t.documentKey),
    index('source_documents_raw_hash_idx').on(t.rawHash),
    index('source_documents_source_idx').on(t.source),
    index('source_documents_url_idx').on(t.canonicalUrl),
    index('source_documents_fetched_idx').on(t.fetchedAt),
  ]
);

// Normalized source observations used as evidence input. Actionable product
// conclusions live in `signals`; this table is not an actionable-event ledger.
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceUrl: text('source_url').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }).notNull(),
    title: text('title'),
    content: text('content'),
    primaryEntityId: text('primary_entity_id').references(() => entities.id),
    rawHash: text('raw_hash').notNull(),
    sourceDocumentId: text('source_document_id').references(() => sourceDocuments.id),
    fetchRunId: text('fetch_run_id'),
    ingestedAt: integer('ingested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('events_raw_hash_idx').on(t.rawHash),
    index('events_published_idx').on(t.publishedAt),
    index('events_primary_entity_idx').on(t.primaryEntityId),
    index('events_source_document_idx').on(t.sourceDocumentId),
    index('events_fetch_run_idx').on(t.fetchRunId),
  ]
);

export const signals = sqliteTable(
  'signals',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    signalType: text('signal_type').notNull(),
    primaryEntityId: text('primary_entity_id')
      .notNull()
      .references(() => entities.id),
    direction: text('direction', { enum: ['up', 'down', 'neutral'] }).notNull(),
    confidence: text('confidence', { enum: ['low', 'medium', 'high'] }).notNull(),
    predictedWindowDays: integer('predicted_window_days').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }).notNull(),
    evidenceUrls: text('evidence_urls', { mode: 'json' }).notNull(),
    spilloverEntityIds: text('spillover_entity_ids', { mode: 'json' }),
    reviewStatus: text('review_status', {
      enum: ['draft', 'published', 'corrected', 'killed'],
    })
      .notNull()
      .default('draft'),
    supersedesSignalId: text('supersedes_signal_id'),
    bodyMd: text('body_md').notNull(),
  },
  (t) => [
    uniqueIndex('signals_slug_idx').on(t.slug),
    index('signals_published_idx').on(t.publishedAt),
    index('signals_primary_entity_idx').on(t.primaryEntityId),
    index('signals_type_idx').on(t.signalType),
  ]
);

export const evidence = sqliteTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    signalId: text('signal_id')
      .notNull()
      .references(() => signals.id),
    url: text('url').notNull(),
    sourceType: text('source_type').notNull(),
    excerpt: text('excerpt'),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
  },
  (t) => [index('evidence_signal_idx').on(t.signalId)]
);

export const scoreRuns = sqliteTable(
  'score_runs',
  {
    id: text('id').primaryKey(),
    signalId: text('signal_id')
      .notNull()
      .references(() => signals.id),
    runAt: integer('run_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    windowDays: integer('window_days').notNull(),
    forwardReturn: real('forward_return'),
    outcome: text('outcome', {
      enum: ['hit', 'miss', 'push', 'pending'],
    }).notNull(),
    notes: text('notes'),
  },
  (t) => [index('score_runs_signal_idx').on(t.signalId), index('score_runs_run_at_idx').on(t.runAt)]
);

// Audit / replay storage — everything we'd want to debug 30d from now without
// access to memory. Append-only, never updated.

export const llmRuns = sqliteTable(
  'llm_runs',
  {
    id: text('id').primaryKey(),
    signalSlug: text('signal_slug'),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    accepted: integer('accepted', { mode: 'boolean' }).notNull(),
    reason: text('reason'),
    requestJson: text('request_json', { mode: 'json' }).notNull(),
    responseJson: text('response_json', { mode: 'json' }),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    latencyMs: integer('latency_ms'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('llm_runs_created_idx').on(t.createdAt),
    index('llm_runs_signal_idx').on(t.signalSlug),
    index('llm_runs_accepted_idx').on(t.accepted),
  ]
);

export const marketQuotes = sqliteTable(
  'market_quotes',
  {
    id: text('id').primaryKey(),
    source: text('source', { enum: ['polymarket', 'manifold', 'kalshi'] }).notNull(),
    marketId: text('market_id').notNull(),
    entityId: text('entity_id').references(() => entities.id),
    question: text('question').notNull(),
    outcome: text('outcome', { enum: ['yes', 'no', 'binary'] }).notNull(),
    prob: real('prob').notNull(),
    volume: real('volume'),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    resolvedOutcome: text('resolved_outcome'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
    marketUrl: text('market_url').notNull(),
  },
  (t) => [
    index('market_quotes_entity_idx').on(t.entityId),
    index('market_quotes_source_market_idx').on(t.source, t.marketId),
    index('market_quotes_fetched_idx').on(t.fetchedAt),
  ]
);

export const ingestRuns = sqliteTable(
  'ingest_runs',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    days: integer('days'),
    eventsFetched: integer('events_fetched').default(0),
    eventsDroppedNoEntity: integer('events_dropped_no_entity').default(0),
    eventsDroppedLowCluster: integer('events_dropped_low_cluster').default(0),
    signalsDrafted: integer('signals_drafted').default(0),
    errors: integer('errors').default(0),
    errorSample: text('error_sample'),
    notes: text('notes'),
  },
  (t) => [
    index('ingest_runs_source_idx').on(t.source),
    index('ingest_runs_started_idx').on(t.startedAt),
  ]
);

// ─── Community lens ───────────────────────────────────────────────────────
// Operator curation, not user data despite the owner_id column: this registry
// decides which subreddits get digested, and the public Daily Brief's
// "Behavior & Culture" section reads the resulting digests. CRUD lives behind
// ADMIN_TOKEN in workers/api/src/routes/admin.ts.

export const trackedCommunities = sqliteTable(
  'tracked_communities',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    subreddit: text('subreddit').notNull(),
    prompt: text('prompt'),
    period: text('period', { enum: ['day', 'week', 'month'] })
      .notNull()
      .default('week'),
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('tracked_communities_owner_idx').on(t.ownerId),
    uniqueIndex('tracked_communities_owner_subreddit_period_idx').on(
      t.ownerId,
      t.subreddit,
      t.period
    ),
  ]
);

export const communityDigestSnapshots = sqliteTable(
  'community_digest_snapshots',
  {
    id: text('id').primaryKey(),
    trackedCommunityId: text('tracked_community_id').references(() => trackedCommunities.id),
    ownerId: text('owner_id').notNull(),
    subreddit: text('subreddit').notNull(),
    period: text('period', { enum: ['day', 'week', 'month'] }).notNull(),
    snapshotDate: integer('snapshot_date', { mode: 'timestamp' }).notNull(),
    summaryText: text('summary_text').notNull(),
    summary: text('summary', { mode: 'json' }),
    promptUsed: text('prompt_used').notNull(),
    sourceCount: integer('source_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('community_digest_snapshots_track_idx').on(t.trackedCommunityId),
    index('community_digest_snapshots_owner_idx').on(t.ownerId),
    index('community_digest_snapshots_subreddit_period_idx').on(t.subreddit, t.period),
  ]
);

// ─── Equities snapshot pipeline (migration 0006) ──────────────────────────
// Universe of ~5,000 tickers; closes table is 5y rolling; ticker_snapshot
// holds the Tier 1/2/3 derived fields refreshed daily.

export const tickers = sqliteTable(
  'tickers',
  {
    ticker: text('ticker').primaryKey(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    name: text('name'),
    assetClass: text('asset_class', {
      enum: ['equity', 'etf', 'index', 'crypto'],
    }).notNull(),
    currency: text('currency'),
    country: text('country'),
    sector: text('sector'),
    industry: text('industry'),
    wikidataId: text('wikidata_id'),
    cik: text('cik'),
    isin: text('isin'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('tickers_exchange_idx').on(t.exchange),
    index('tickers_asset_class_idx').on(t.assetClass),
    index('tickers_country_idx').on(t.country),
    index('tickers_cik_idx').on(t.cik),
  ]
);

export const closes = sqliteTable(
  'closes',
  {
    ticker: text('ticker')
      .notNull()
      .references(() => tickers.ticker),
    date: integer('date').notNull(),
    close: real('close').notNull(),
    volume: real('volume'),
  },
  (t) => [index('closes_date_idx').on(t.date), uniqueIndex('closes_pk').on(t.ticker, t.date)]
);

export const tickerSnapshot = sqliteTable(
  'ticker_snapshot',
  {
    ticker: text('ticker')
      .primaryKey()
      .references(() => tickers.ticker),

    // Tier 1 — derived from closes
    lastClose: real('last_close'),
    lastDate: integer('last_date'),
    ret1d: real('ret_1d'),
    ret30d: real('ret_30d'),
    ret90d: real('ret_90d'),
    ret1y: real('ret_1y'),
    ret5y: real('ret_5y'),
    ret1dUsd: real('ret_1d_usd'),
    ret30dUsd: real('ret_30d_usd'),
    ret90dUsd: real('ret_90d_usd'),
    ret1yUsd: real('ret_1y_usd'),
    ret5yUsd: real('ret_5y_usd'),
    volumeAvg30d: real('volume_avg_30d'),
    volatility30d: real('volatility_30d'),
    high52w: real('high_52w'),
    low52w: real('low_52w'),
    distTo52wHigh: real('dist_to_52w_high'),
    distTo52wLow: real('dist_to_52w_low'),
    maxDrawdown1y: real('max_drawdown_1y'),
    maxDrawdown5y: real('max_drawdown_5y'),
    sma50: real('sma_50'),
    sma200: real('sma_200'),
    goldenCross: integer('golden_cross', { mode: 'boolean' }).default(false),
    deathCross: integer('death_cross', { mode: 'boolean' }).default(false),
    betaVsSpy: real('beta_vs_spy'),
    relStrengthSpy90d: real('rel_strength_spy_90d'),

    // Tier 2
    dividendYield: real('dividend_yield'),
    fxToUsd: real('fx_to_usd'),
    wikipediaPageviews7dAvg: real('wikipedia_pageviews_7d_avg'),

    // Tier 3 — mostly US via SEC; nullable for international
    marketCap: real('market_cap'),
    sharesOutstanding: real('shares_outstanding'),
    revenueLatest: real('revenue_latest'),
    revenueYoy: real('revenue_yoy'),
    netIncomeLatest: real('net_income_latest'),
    netIncomeYoy: real('net_income_yoy'),
    fcfLatest: real('fcf_latest'),
    grossMargin: real('gross_margin'),
    operatingMargin: real('operating_margin'),
    shortInterestShares: real('short_interest_shares'),
    shortInterestPct: real('short_interest_pct'),
    insiderBuys90d: integer('insider_buys_90d'),
    insiderSells90d: integer('insider_sells_90d'),
    insiderNetShares90d: real('insider_net_shares_90d'),
    earningsNext: text('earnings_next'),
    earningsLast: text('earnings_last'),
    mentionsGdelt30d: integer('mentions_gdelt_30d'),
    mentionsReddit30d: integer('mentions_reddit_30d'),
    mentionsHn30d: integer('mentions_hn_30d'),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('ticker_snapshot_updated_idx').on(t.updatedAt)]
);

export const indexMemberships = sqliteTable(
  'index_memberships',
  {
    ticker: text('ticker')
      .notNull()
      .references(() => tickers.ticker),
    indexName: text('index_name').notNull(),
    addedAt: integer('added_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('index_memberships_index_idx').on(t.indexName),
    uniqueIndex('index_memberships_pk').on(t.ticker, t.indexName),
  ]
);

export const fxRates = sqliteTable(
  'fx_rates',
  {
    currency: text('currency').notNull(),
    date: integer('date').notNull(),
    rateToUsd: real('rate_to_usd').notNull(),
  },
  (t) => [index('fx_rates_date_idx').on(t.date), uniqueIndex('fx_rates_pk').on(t.currency, t.date)]
);

export const riskFreeRates = sqliteTable(
  'risk_free_rates',
  {
    series: text('series').notNull(),
    date: integer('date').notNull(),
    value: real('value').notNull(),
  },
  (t) => [uniqueIndex('risk_free_rates_pk').on(t.series, t.date)]
);

export const institutionalHolders = sqliteTable(
  'institutional_holders',
  {
    ticker: text('ticker')
      .notNull()
      .references(() => tickers.ticker),
    filerCik: text('filer_cik').notNull(),
    asOfDate: integer('as_of_date').notNull(),
    filerName: text('filer_name'),
    shares: real('shares'),
    valueUsd: real('value_usd'),
  },
  (t) => [
    index('institutional_holders_asof_idx').on(t.asOfDate),
    uniqueIndex('institutional_holders_pk').on(t.ticker, t.filerCik, t.asOfDate),
  ]
);

export const insiderTransactions = sqliteTable(
  'insider_transactions',
  {
    ticker: text('ticker')
      .notNull()
      .references(() => tickers.ticker),
    filingId: text('filing_id').notNull(),
    filingDate: integer('filing_date').notNull(),
    insiderName: text('insider_name'),
    relationship: text('relationship'),
    transactionType: text('transaction_type'),
    shares: real('shares'),
    price: real('price'),
    totalValue: real('total_value'),
  },
  (t) => [
    index('insider_transactions_filing_date_idx').on(t.filingDate),
    index('insider_transactions_ticker_date_idx').on(t.ticker, t.filingDate),
    uniqueIndex('insider_transactions_pk').on(t.ticker, t.filingId),
  ]
);

// ─── Claim provenance (migration 0009) ─────────────────────────────────────
// Plan 0008. Structured ledger of atomic claims, their evidence-link roles,
// and a per-claim timeline. Signals + evidence remain canonical; claims are
// an additive index the /review editor and auto-publish rules read.

export const claimRecords = sqliteTable(
  'claim_records',
  {
    id: text('id').primaryKey(),
    signalId: text('signal_id'),
    briefItemId: text('brief_item_id'),
    agentEvalResponseId: text('agent_eval_response_id'),
    surface: text('surface', { enum: ['signal', 'brief', 'agent_eval'] }).notNull(),
    assertion: text('assertion').notNull(),
    confidenceBand: text('confidence_band', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    reviewStatus: text('review_status', {
      enum: ['draft', 'held', 'published', 'killed', 'corrected'],
    })
      .notNull()
      .default('draft'),
    publishReason: text('publish_reason'),
    parentClaimId: text('parent_claim_id'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    correctedAt: integer('corrected_at', { mode: 'timestamp' }),
  },
  (t) => [
    index('claim_records_signal_idx').on(t.signalId),
    index('claim_records_parent_idx').on(t.parentClaimId),
    index('claim_records_surface_status_idx').on(t.surface, t.reviewStatus),
  ]
);

export const claimEvidenceLinks = sqliteTable(
  'claim_evidence_links',
  {
    id: text('id').primaryKey(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claimRecords.id),
    evidenceUrl: text('evidence_url').notNull(),
    sourceDocumentId: text('source_document_id'),
    role: text('role', {
      enum: ['primary', 'corroboration', 'contradiction', 'context'],
    }).notNull(),
    weight: integer('weight').notNull().default(1),
    notes: text('notes'),
    addedAt: integer('added_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    addedBy: text('added_by'),
  },
  (t) => [
    index('claim_evidence_claim_idx').on(t.claimId),
    index('claim_evidence_url_idx').on(t.evidenceUrl),
    index('claim_evidence_doc_idx').on(t.sourceDocumentId),
  ]
);

export const claimTimelineEvents = sqliteTable(
  'claim_timeline_events',
  {
    id: text('id').primaryKey(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claimRecords.id),
    kind: text('kind', {
      enum: ['created', 'evidence_added', 'evidence_removed', 'status_change', 'correction_filed'],
    }).notNull(),
    payload: text('payload', { mode: 'json' }).notNull().default('{}'),
    actor: text('actor'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('claim_timeline_claim_idx').on(t.claimId, t.createdAt)]
);

// Migrations 0010-0012 (brief email delivery, watchlists, the cited-URL index)
// were dropped by migration 0020 along with the rest of the per-user surface.

// ─── Daily brief snapshots (migration 0013) ───────────────────────────────
// Precomputed brief JSON per region per day, populated by cron.
// Eliminates 5-14 sequential D1 queries per /brief/daily request.

export const dailyBriefSnapshots = sqliteTable(
  'daily_brief_snapshots',
  {
    date: text('date').notNull(),
    region: text('region').notNull().default('global'),
    briefJson: text('brief_json').notNull(),
    computedAt: text('computed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.region] })]
);

// ─── Signal hit-rate cache (migration 0013) ───────────────────────────────
// Precomputed hit-rate per signal type/family, refreshed hourly.

export const signalHitRateCache = sqliteTable(
  'signal_hit_rate_cache',
  {
    signalType: text('signal_type').notNull(),
    family: text('family').notNull(),
    hits: integer('hits').notNull().default(0),
    misses: integer('misses').notNull().default(0),
    pushes: integer('pushes').notNull().default(0),
    sampleCount: integer('sample_count').notNull().default(0),
    computedAt: text('computed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.signalType, t.family] })]
);

// ─── Company universe (migration 0017) ───────────────────────────────────
// Generated High Signal company repertoire plus deterministic competitor map.
// `company_universe_runs` records each generated run; the current product/API
// reads the latest run through the company and competitor tables.

export const companyUniverseRuns = sqliteTable('company_universe_runs', {
  id: text('id').primaryKey(),
  generatedAt: text('generated_at').notNull(),
  sourceInputsJson: text('source_inputs_json').notNull(),
  companyCount: integer('company_count').notNull().default(0),
  competitorCount: integer('competitor_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const companyUniverseCompanies = sqliteTable(
  'company_universe_companies',
  {
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('Other'),
    investorsJson: text('investors_json').notNull().default('[]'),
    sourceEvidenceJson: text('source_evidence_json').notNull().default('[]'),
    generatedAt: text('generated_at').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    status: text('status', {
      enum: ['generated', 'pending_enrichment', 'enriched', 'failed'],
    })
      .notNull()
      .default('generated'),
    domain: text('domain'),
    requestedBy: text('requested_by'),
    requestedAt: integer('requested_at', { mode: 'timestamp' }),
    lastEnrichedAt: integer('last_enriched_at', { mode: 'timestamp' }),
  },
  (t) => [
    index('company_universe_companies_name_idx').on(t.name),
    index('company_universe_companies_category_idx').on(t.category),
    index('company_universe_companies_generated_idx').on(t.generatedAt),
    index('company_universe_companies_domain_idx').on(t.domain),
    index('company_universe_companies_status_idx').on(t.status),
  ]
);

export const companyUniverseCompetitors = sqliteTable(
  'company_universe_competitors',
  {
    companySlug: text('company_slug')
      .notNull()
      .references(() => companyUniverseCompanies.slug, { onDelete: 'cascade' }),
    competitorSlug: text('competitor_slug')
      .notNull()
      .references(() => companyUniverseCompanies.slug, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    reason: text('reason').notNull(),
    generatedAt: text('generated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companySlug, t.competitorSlug] }),
    index('company_universe_competitors_company_idx').on(t.companySlug, t.score),
    index('company_universe_competitors_competitor_idx').on(t.competitorSlug),
  ]
);

// ─── India D2C Opportunity Pipeline (migration 0016) ──────────────────────
// Plan 0013, Slice 3 — persistence + history. The 20 curated niches live in
// `d2c_niches` (slug-keyed, stable); weekly snapshots live in
// `d2c_niche_snapshots` (one row per niche per snapshot_date, append-only).
// Verdict changes and score deltas are read by joining consecutive snapshots.

export const d2cNiches = sqliteTable(
  'd2c_niches',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    region: text('region').notNull().default('south-asia'),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('d2c_niches_slug_idx').on(t.slug),
    index('d2c_niches_category_idx').on(t.category),
  ]
);

export const d2cNicheSnapshots = sqliteTable(
  'd2c_niche_snapshots',
  {
    id: text('id').primaryKey(),
    nicheId: text('niche_id')
      .notNull()
      .references(() => d2cNiches.id),
    snapshotDate: integer('snapshot_date', { mode: 'timestamp' }).notNull(),
    opportunityScore: integer('opportunity_score').notNull(),
    demandScore: real('demand_score'),
    competitionScore: real('competition_score'),
    pricingScore: real('pricing_score'),
    adSaturationScore: real('ad_saturation_score'),
    agentVisibilityScore: real('agent_visibility_score'),
    sourceDiversity: real('source_diversity').notNull(),
    verdict: text('verdict', { enum: ['enter', 'test', 'watch', 'avoid'] }).notNull(),
    confidence: text('confidence', { enum: ['low', 'medium', 'high'] }).notNull(),
    evidenceJson: text('evidence_json', { mode: 'json' }).notNull(),
    freshnessDate: text('freshness_date').notNull(),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('d2c_niche_snapshots_niche_date_idx').on(t.nicheId, t.snapshotDate),
    index('d2c_niche_snapshots_date_idx').on(t.snapshotDate),
    index('d2c_niche_snapshots_verdict_idx').on(t.verdict),
  ]
);

// Slice 4 — agent-visibility overlay: which brands AI assistants recommend
// and cite for each niche's category prompt. One row per (niche, platform,
// run_date). The "agent answer gap" in each Opportunity Brief is derived
// from the most recent run per niche.
export const d2cAgentVisibility = sqliteTable(
  'd2c_agent_visibility',
  {
    id: text('id').primaryKey(),
    nicheId: text('niche_id')
      .notNull()
      .references(() => d2cNiches.id),
    platform: text('platform').notNull(),
    model: text('model').notNull(),
    promptText: text('prompt_text').notNull(),
    responseText: text('response_text').notNull(),
    recommendedBrands: text('recommended_brands', { mode: 'json' }).notNull().default('[]'),
    citedUrls: text('cited_urls', { mode: 'json' }).notNull().default('[]'),
    brandMentioned: integer('brand_mentioned', { mode: 'boolean' }).notNull().default(false),
    gapScore: real('gap_score'),
    runDate: integer('run_date', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('d2c_agent_visibility_niche_idx').on(t.nicheId),
    index('d2c_agent_visibility_run_idx').on(t.runDate),
    index('d2c_agent_visibility_platform_idx').on(t.platform),
  ]
);
