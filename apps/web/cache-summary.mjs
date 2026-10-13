import {
  OBSERVATION_COHORTS,
  observationContext,
  observationVersion,
} from '../../packages/shared/observation-context.mjs';

const countNames = ['hits', 'misses', 'bypasses', 'eligible'];
const emptyCounts = () => Object.fromEntries(countNames.map((name) => [name, 0]));
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
    cohorts = emptyCohorts();
    return record;
  };
  return (response, eligible, request = null, versions = {}) => {
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
    if (endedAt - startedAt >= 60_000) return finish(endedAt);
    return record;
  };
}

// Whitelist bounded aggregate fields before forwarding through the existing SDK.
export function cacheSummaryProps(record) {
  if (!record || record.event !== 'web.cache.summary') return null;
  const keys = [
    'started_at',
    'ended_at',
    ...countNames,
    ...OBSERVATION_COHORTS.flatMap((cohort) => countNames.map((name) => `${cohort}_${name}`)),
  ];
  if (keys.some((key) => !Number.isSafeInteger(record[key]) || record[key] < 0)) return null;
  if (record.ended_at < record.started_at) return null;
  if (
    countNames.some(
      (name) =>
        OBSERVATION_COHORTS.reduce((sum, cohort) => sum + record[`${cohort}_${name}`], 0) !==
        record[name]
    )
  )
    return null;
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
