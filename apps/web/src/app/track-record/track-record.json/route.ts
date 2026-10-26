import { hasAdminSession } from '@/lib/admin-guard';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await hasAdminSession(request))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let cohorts: Awaited<ReturnType<typeof api.trackRecordCohorts>> = {
    live: [],
    backfill: [],
    all: [],
  };
  try {
    cohorts = await api.trackRecordCohorts();
  } catch {
    /* offline */
  }

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), cohorts }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
