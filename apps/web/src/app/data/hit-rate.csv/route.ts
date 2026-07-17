import { api, type TrackBucket } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function csvEscape(value: string | number | null): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toRow(cohort: 'live' | 'backfill', b: TrackBucket): string {
  return [
    csvEscape(b.signalType),
    csvEscape(cohort),
    csvEscape(b.hit),
    csvEscape(b.miss),
    csvEscape(b.push),
    csvEscape(b.pending),
    csvEscape(b.total),
    csvEscape(b.hitRate),
  ].join(',');
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
    /* offline — return header only */
  }

  const header = 'signal_type,cohort,hit,miss,push,pending,total,hit_rate';
  const rows = [
    ...cohorts.live.map((b) => toRow('live', b)),
    ...cohorts.backfill.map((b) => toRow('backfill', b)),
  ];
  const csv = [header, ...rows].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Content-Disposition': 'attachment; filename="high-signal-hit-rate.csv"',
    },
  });
}
