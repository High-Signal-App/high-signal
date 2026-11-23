import {
  OBSERVATION_COHORTS,
  observationContext,
  observationVersion,
} from '../../packages/shared/observation-context.mjs';

const countNames = ['hits', 'misses', 'bypasses', 'eligible'];
const recordCountNames = [
  'record_available',
  'record_missing',
  'record_unavailable',
  'record_cache_hits',
  'record_cache_misses',
  'record_cache_match_errors',
  'record_head_requests',
  'record_head_cache_misses',
  'record_puts_scheduled',
  'record_puts_fulfilled',
  'record_puts_rejected',
];
const emptyCounts = () => Object.fromEntries(countNames.map((name) => [name, 0]));
const emptyRecordCounts = () => Object.fromEntries(recordCountNames.map((name) => [name, 0]));
const emptyCohorts = () =>
  Object.fromEntries(OBSERVATION_COHORTS.map((cohort) => [cohort, emptyCounts()]));
const increment = (counts, name) => {
  counts[name] = Math.min(Number.MAX_SAFE_INTEGER, counts[name] + 1);
};

// Aggregate Worker-executed outcomes only; no request content crosses requests.
export function createCacheSummary(now = Date.now, emit = console.info) {
  // Workers freeze the clock during module initialization; start in a request.
  let startedAt;
  let counts = emptyCounts();
  let recordCounts = emptyRecordCounts();
  let cohorts = emptyCohorts();
  let version;
  const finish = (endedAt) => {
    const record = {
      event: 'web.cache.summary',
      scope: 'worker_executed',
      started_at: startedAt,
      ended_at: endedAt,
      ...version,
      ...counts,
      ...recordCounts,
      ...Object.fromEntries(
        OBSERVATION_COHORTS.flatMap((cohort) =>
          countNames.map((name) => [`${cohort}_${name}`, cohorts[cohort][name]])
        )
      ),
      eligible_hit_percent: counts.eligible ? (100 * counts.hits) / counts.eligible : null,
      overall_hit_percent: (100 * counts.hits) / (counts.hits + counts.misses + counts.bypasses),
      target_percent: 95,
    };
    emit(JSON.stringify(record));
    startedAt = endedAt;
    counts = emptyCounts();
    recordCounts = emptyRecordCounts();
    cohorts = emptyCohorts();
    return record;
  };
  const summarize = (response, eligible, request = null, versions = {}, recordOutcomes = []) => {
    const context = observationContext(request, versions);
    const nextVersion = { version: context.version, version_source: context.version_source };
    const endedAt = now();
    startedAt ??= endedAt;
    let record;
    if (
      version &&
      (version.version !== nextVersion.version ||
        version.version_source !== nextVersion.version_source)
    )
      record = finish(endedAt);
    version = nextVersion;
    const status = response?.headers.get('x-edge-cache') ?? '';
    const outcome = /(^|-)HIT$/.test(status)
      ? 'hits'
      : /(^|-)MISS$/.test(status)
        ? 'misses'
        : 'bypasses';
    increment(counts, outcome);
    increment(cohorts[context.traffic_cohort], outcome);
    if (eligible || /^(AGENT|RSC)-(HIT|MISS)$/.test(status)) {
      increment(counts, 'eligible');
      increment(cohorts[context.traffic_cohort], 'eligible');
    }
    for (const item of recordOutcomes) {
      if (item?.type === 'cache') summarize.recordCacheOutcome(item);
      else if (item?.type === 'put') summarize.recordPutOutcome(item.outcome);
    }
    if (endedAt - startedAt >= 60_000) return finish(endedAt);
    return record;
  };
  // Aggregate bounded record outcomes in the existing summary stream; never
  // attach identifiers, paths, request headers, or per-request log events.
  summarize.recordCacheOutcome = ({ state, method, hit, matchError = false } = {}) => {
    if (!['available', 'missing', 'unavailable'].includes(state)) return;
    increment(recordCounts, `record_${state}`);
    increment(recordCounts, hit ? 'record_cache_hits' : 'record_cache_misses');
    if (matchError) increment(recordCounts, 'record_cache_match_errors');
    if (method === 'HEAD') {
      increment(recordCounts, 'record_head_requests');
      if (!hit) increment(recordCounts, 'record_head_cache_misses');
    }
  };
  summarize.recordPutOutcome = (outcome) => {
    // Writes are deliberately waitUntil work; completion counts land in the
    // summary window in which settlement is observed, without delaying a page.
    if (outcome === 'scheduled') increment(recordCounts, 'record_puts_scheduled');
    else if (outcome === 'fulfilled') increment(recordCounts, 'record_puts_fulfilled');
    else if (outcome === 'rejected') increment(recordCounts, 'record_puts_rejected');
  };
  return summarize;
}

// Whitelist bounded aggregate fields before forwarding through the existing SDK.
export function cacheSummaryProps(record) {
  if (!record || record.event !== 'web.cache.summary') return null;
  const baseKeys = [
    'started_at',
    'ended_at',
    ...countNames,
    ...OBSERVATION_COHORTS.flatMap((cohort) => countNames.map((name) => `${cohort}_${name}`)),
  ];
  if (baseKeys.some((key) => !Number.isSafeInteger(record[key]) || record[key] < 0)) return null;
  if (record.ended_at < record.started_at) return null;
  if (
    countNames.some(
      (name) =>
        OBSERVATION_COHORTS.reduce((sum, cohort) => sum + record[`${cohort}_${name}`], 0) !==
        record[name]
    )
  )
    return null;
  const recordCountsValid =
    recordCountNames.every((key) => Number.isSafeInteger(record[key]) && record[key] >= 0) &&
    record.record_available + record.record_missing + record.record_unavailable ===
      record.record_cache_hits + record.record_cache_misses &&
    record.record_cache_match_errors <= record.record_cache_misses &&
    record.record_head_cache_misses <= record.record_head_requests &&
    record.record_head_requests <= record.record_cache_hits + record.record_cache_misses &&
    record.record_puts_scheduled <= record.record_available &&
    record.record_puts_scheduled <= record.record_cache_misses;
  // These fields are additive. Legacy rows and malformed future diagnostic
  // groups must not suppress the established cache summary counters.
  const keys = [...baseKeys, ...(recordCountsValid ? recordCountNames : [])];
  const declaredSource = ['app_health_release', 'reader_source', 'cache_build'].includes(
    record.version_source
  )
    ? record.version_source
    : 'unknown';
  const version = observationVersion(record.version, declaredSource);
  const version_source = version === 'unknown' ? 'unknown' : declaredSource;
  return {
    ...Object.fromEntries(keys.map((key) => [key, record[key]])),
    scope: 'worker_executed',
    version,
    version_source,
    eligible_hit_percent: record.eligible ? (100 * record.hits) / record.eligible : null,
    overall_hit_percent:
      record.hits + record.misses + record.bypasses
        ? (100 * record.hits) / (record.hits + record.misses + record.bypasses)
        : null,
    target_percent: 95,
  };
}
