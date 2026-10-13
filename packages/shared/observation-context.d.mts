export type ObservationCohort = 'unknown' | 'declared_publisher' | 'declared_diagnostic';
export interface ObservationContext {
  traffic_cohort: ObservationCohort;
  version: string;
  version_source: 'app_health_release' | 'reader_source' | 'cache_build' | 'unknown';
}
export const OBSERVATION_COHORTS: readonly ObservationCohort[];
export function observationVersion(
  value: unknown,
  source?: ObservationContext['version_source']
): string;
export function observationContext(
  request: Request | null,
  versions?: { release?: unknown; readerSource?: unknown; cacheBuild?: unknown }
): ObservationContext;
