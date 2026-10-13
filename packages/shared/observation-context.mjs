// These are declarations, not authenticated identities or proof of human traffic.
export const OBSERVATION_COHORTS = Object.freeze([
  'unknown',
  'declared_publisher',
  'declared_diagnostic',
]);
const VERSION =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|v?\d{1,8}\.\d{1,8}\.\d{1,8}(?:[-.][a-z0-9.-]{1,64})?)$/i;

export function observationVersion(value, source = 'app_health_release') {
  if (!['app_health_release', 'reader_source', 'cache_build'].includes(source)) return 'unknown';
  if (typeof value !== 'string' || value.length > 128) return 'unknown';
  const valid =
    source === 'cache_build' ? /^[A-Za-z0-9._-]{1,128}$/.test(value) : VERSION.test(value);
  return valid ? value : 'unknown';
}

export function observationContext(request, versions = {}) {
  let traffic_cohort = 'unknown';
  if (request) {
    const url = new URL(request.url);
    if (url.searchParams.get('timing') === '1' || url.searchParams.has('validation'))
      traffic_cohort = 'declared_diagnostic';
    else if (
      /^HighSignal-reader-publisher\/1(?:\s|$)/.test(request.headers.get('user-agent') ?? '')
    )
      traffic_cohort = 'declared_publisher';
  }
  for (const [version_source, value] of [
    ['app_health_release', versions.release],
    ['reader_source', versions.readerSource],
    ['cache_build', versions.cacheBuild],
  ]) {
    const version = observationVersion(value, version_source);
    if (version !== 'unknown') return { traffic_cohort, version, version_source };
  }
  return { traffic_cohort, version: 'unknown', version_source: 'unknown' };
}
