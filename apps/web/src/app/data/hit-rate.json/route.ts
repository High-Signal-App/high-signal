import { api, type TrackBucket } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

interface BucketRow {
  signalType: string;
  cohort: 'live' | 'backfill';
  hit: number;
  miss: number;
  push: number;
  pending: number;
  total: number;
  hitRate: number | null;
}

function toRows(cohort: 'live' | 'backfill', buckets: TrackBucket[]): BucketRow[] {
  return buckets.map((b) => ({
    signalType: b.signalType,
    cohort,
    hit: b.hit,
    miss: b.miss,
    push: b.push,
    pending: b.pending,
    total: b.total,
    hitRate: b.hitRate,
  }));
}

export async function GET(): Promise<Response> {
  let cohorts: { live: TrackBucket[]; backfill: TrackBucket[]; all: TrackBucket[] } = {
    live: [],
    backfill: [],
    all: [],
  };
  try {
    cohorts = await api.trackRecordCohorts();
  } catch {
    /* offline — return empty */
  }

  const rows = [...toRows('live', cohorts.live), ...toRows('backfill', cohorts.backfill)];

  const payload = {
    dataset: 'high-signal-hit-rate-ledger',
    description:
      'Every published High Signal market signal scored against subsequent market moves. Hit-rate excludes pushes. Live = forward predictions; Backfill = historical replay calibration.',
    license: 'CC-BY-4.0',
    generatedAt: new Date().toISOString(),
    schema: {
      signalType: 'string — the signal type slug (e.g. capex_raise, order_book_softness)',
      cohort: '"live" (forward predictions) or "backfill" (historical replay)',
      hit: 'integer — predictions where the market moved in the predicted direction',
      miss: 'integer — predictions where the market moved against the prediction',
      push: 'integer — predictions where the move was too small to call (excluded from hit-rate)',
      pending: 'integer — predictions whose scoring window has not closed',
      total: 'integer — hit + miss + push + pending',
      hitRate: 'float or null — hits / (hits + misses); null when no scored predictions',
    },
    rows,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Content-Disposition': 'attachment; filename="high-signal-hit-rate.json"',
    },
  });
}
