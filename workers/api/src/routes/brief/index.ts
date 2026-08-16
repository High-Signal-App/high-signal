export {
  COMMUNITY_DIGEST_LOOKBACK_DAYS,
  HIT_RATE_FAMILY_MIN,
  HIT_RATE_SAMPLE_MIN,
  IDEAS_LIMIT,
  RECENT_SIGNAL_WINDOW_DAYS,
  STOCKS_LIMIT,
  TRENDS_LIMIT,
  computeHitRate,
  d2cBriefItemsForRegion,
  headlineFromBody,
  isBriefStockEvidenceEligible,
  isPublicSourceLink,
  mergeIntentIntoImprovements,
  mergeIntentIntoPerception,
  pickSpotlight,
  rankStocks,
  renderFromSeed,
  resolveHitRate,
  safe,
  safeCategory,
  seedToBrief,
  type BucketCounts,
  type PublicCategoryResult,
  type RankableRow,
} from './compose';

export { loadBriefFeedEdition } from './query';

export { briefRoute, precomputeBriefSnapshots } from './route';
