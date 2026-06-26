import {
  buildDailyAutomationStatus,
  buildDailySourceQualityAudit,
  readSourceRefreshes,
  resolveAcceptedRefreshDate,
  type SourceQualityStatus,
} from '@/lib/daily-intelligence';

export const dynamic = 'force-dynamic';

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedDate = safeDate(url.searchParams.get('date'));
  const status = url.searchParams.get('status');
  const selectedStatus = ['accepted', 'rejected', 'missing'].includes(status ?? '')
    ? (status as SourceQualityStatus)
    : '';
  const selectedClass = url.searchParams.get('class') ?? '';
  const refreshes = await readSourceRefreshes();
  const sourceReadDate = resolveAcceptedRefreshDate(refreshes, requestedDate) ?? requestedDate;
  const sourceQualityAudit = buildDailySourceQualityAudit(refreshes, sourceReadDate);
  const automationStatus = buildDailyAutomationStatus(refreshes);
  const filteredRows = sourceQualityAudit.rows.filter(
    (row) =>
      (!selectedStatus || row.status === selectedStatus) &&
      (!selectedClass || row.sourceClass === selectedClass)
  );

  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      requestedDate,
      sourceReadDate,
      sourceDateShifted: sourceReadDate !== requestedDate,
      filters: {
        status: selectedStatus,
        sourceClass: selectedClass,
      },
      filteredRows,
      sourceQualityAudit,
      automationStatus,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    }
  );
}
