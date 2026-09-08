import type { TrackBucket } from './api';

/** Counts scoring records, not distinct predictions or calibrated confidence. */
export function summarizeTrackBuckets(buckets: TrackBucket[]) {
  const summary = buckets.reduce(
    (acc, bucket) => ({
      hit: acc.hit + bucket.hit,
      miss: acc.miss + bucket.miss,
      push: acc.push + bucket.push,
      pending: acc.pending + bucket.pending,
      total: acc.total + bucket.total,
    }),
    { hit: 0, miss: 0, push: 0, pending: 0, total: 0 }
  );
  const resolved = summary.hit + summary.miss;
  return {
    ...summary,
    resolved,
    hitRate: resolved > 0 ? summary.hit / resolved : null,
    smallResolvedSample: resolved > 0 && resolved < 10,
  };
}
