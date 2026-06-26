import { dailyReadMatches, safeReadDomain, safeReadLayer } from '@/lib/daily-read-filters';
import { DAILY_REQUIREMENT_GATE, buildDailyRequirementQueue } from '@/lib/daily-requirements';
import { buildDailyRequirementTaskExports } from '@/lib/daily-task-export';
import {
  buildDailyAutomationStatus,
  buildDailyBroadInsightsWithAnnotations,
  dailyAnnotationRuntime,
  defaultDailyAnnotationOptions,
  resolveAcceptedRefreshDate,
  readSourceRefreshes,
} from '@/lib/daily-intelligence';
import productGraph from '../../../../../../data/personal-product-graph.json';
import type { PersonalProductProfile, SignalContentCategory } from '@high-signal/shared';

export const dynamic = 'force-dynamic';

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = safeDate(url.searchParams.get('date'));
  const category = url.searchParams.get('category') as SignalContentCategory | null;
  const layer = safeReadLayer(url.searchParams.get('layer'));
  const domain = safeReadDomain(url.searchParams.get('domain'));
  const requirement = url.searchParams.get('requirement') !== 'no';
  const refreshes = await readSourceRefreshes();
  const sourceReadDate = resolveAcceptedRefreshDate(refreshes, date) ?? date;
  const allBroadInsights = await buildDailyBroadInsightsWithAnnotations(
    refreshes,
    sourceReadDate,
    defaultDailyAnnotationOptions()
  );
  const broadInsights = allBroadInsights.filter((item) =>
    dailyReadMatches(item, {
      category: category ?? '',
      layer,
      domain,
      requirement,
    })
  );
  const products = productGraph.products as PersonalProductProfile[];
  const requirementQueue = buildDailyRequirementQueue(broadInsights, 50, products);
  const taskExports = buildDailyRequirementTaskExports(requirementQueue);
  const annotationRuntime = await dailyAnnotationRuntime();
  const automationStatus = buildDailyAutomationStatus(refreshes);

  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      date,
      requestedDate: date,
      sourceReadDate,
      sourceDateShifted: sourceReadDate !== date,
      category,
      layer,
      domain,
      requirement,
      count: taskExports.length,
      requirementGate: DAILY_REQUIREMENT_GATE,
      taskExports,
      tasks: taskExports.map((item) => item.task),
      requirementIds: taskExports.map((item) => item.requirementId),
      annotationRuntime,
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
