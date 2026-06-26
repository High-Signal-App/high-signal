import type { DailyReadFilters } from './daily-read-filters';
import { dailyReadMatches } from './daily-read-filters';
import { buildDailyRequirementQueue } from './daily-requirements';
import {
  buildDailyRequirementTaskExports,
  type DailyRequirementTaskExport,
} from './daily-task-export';
import {
  acceptedRefreshDates,
  buildDailyBroadInsightsWithAnnotations,
  type DailyAnnotationOptions,
  type ProductFlowRefreshRecord,
} from './daily-intelligence';
import { addDays, countBy } from '@high-signal/shared';
import type {
  LightweightAudience,
  LightweightDomain,
  LightweightRequirementType,
  LightweightSignalLayer,
  PersonalProductProfile,
} from '@high-signal/shared';

const MAX_DAYS = 31;

export type DailyRangeDaySummary = {
  date: string;
  accepted: boolean;
  broadInsightCount: number;
  requirementCount: number;
  taskExportCount: number;
  productRequirementCount: number;
  sourceCount: number;
  repeatedSignalCount: number;
  qualityGateCounts: Array<{ k: string; n: number }>;
  audienceCounts: Array<{ k: LightweightAudience; n: number }>;
  requirementTypeCounts: Array<{ k: LightweightRequirementType; n: number }>;
  layerCounts: Array<{ k: LightweightSignalLayer; n: number }>;
  domainCounts: Array<{ k: LightweightDomain; n: number }>;
  topRequirements: Array<{
    id: string;
    title: string;
    score: number;
    priority: string;
    href: string;
    fleetTarget: {
      productSlug: string;
      productName: string;
      action: string;
      fitScore: number;
    } | null;
  }>;
  taskExports: DailyRequirementTaskExport[];
};

export type DailyRangeSummary = {
  requestedFrom: string;
  requestedTo: string;
  from: string;
  to: string;
  daysRequested: number;
  daysReturned: number;
  acceptedDateCount: number;
  filters: DailyReadFilters;
  totals: {
    broadInsights: number;
    requirements: number;
    taskExports: number;
    productRequirements: number;
    sourceCount: number;
    repeatedSignalCount: number;
  };
  days: DailyRangeDaySummary[];
};

function isDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function compareDate(a: string, b: string) {
  return a.localeCompare(b);
}

function clampDays(value: number) {
  if (!Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(MAX_DAYS, Math.trunc(value)));
}

export function resolveDailyRangeDates(input: {
  availableDates: string[];
  from?: string | null;
  to?: string | null;
  days?: number | null;
}) {
  const sortedAvailable = Array.from(new Set(input.availableDates))
    .filter(isDate)
    .sort(compareDate);
  const latest = sortedAvailable.at(-1) ?? new Date().toISOString().slice(0, 10);
  const requestedTo = isDate(input.to) ? input.to! : latest;
  const days = clampDays(input.days ?? 7);
  const requestedFrom = isDate(input.from) ? input.from! : addDays(requestedTo, 1 - days);
  const from = compareDate(requestedFrom, requestedTo) <= 0 ? requestedFrom : requestedTo;
  const to = compareDate(requestedFrom, requestedTo) <= 0 ? requestedTo : requestedFrom;
  const availableInRange = sortedAvailable.filter(
    (date) => compareDate(date, from) >= 0 && compareDate(date, to) <= 0
  );
  const fallback = sortedAvailable.filter((date) => compareDate(date, to) <= 0).slice(-days);
  const dates = (availableInRange.length > 0 ? availableInRange : fallback)
    .slice(-MAX_DAYS)
    .sort((a, b) => b.localeCompare(a));
  return {
    requestedFrom,
    requestedTo,
    from,
    to,
    daysRequested: days,
    dates,
  };
}

export async function buildDailyRangeSummary(input: {
  records: ProductFlowRefreshRecord[];
  filters: DailyReadFilters;
  products: PersonalProductProfile[];
  annotationOptions?: DailyAnnotationOptions;
  from?: string | null;
  to?: string | null;
  days?: number | null;
  includeTasks?: boolean;
}) {
  const availableDates = acceptedRefreshDates(input.records);
  const range = resolveDailyRangeDates({
    availableDates,
    from: input.from,
    to: input.to,
    days: input.days,
  });
  const days: DailyRangeDaySummary[] = [];
  for (const date of range.dates) {
    const allInsights = await buildDailyBroadInsightsWithAnnotations(
      input.records,
      date,
      input.annotationOptions
    );
    const insights = allInsights.filter((item) => dailyReadMatches(item, input.filters));
    const requirementQueue = buildDailyRequirementQueue(insights, 20, input.products);
    const taskExports = buildDailyRequirementTaskExports(requirementQueue);
    days.push({
      date,
      accepted: allInsights.length > 0,
      broadInsightCount: insights.length,
      requirementCount: requirementQueue.length,
      taskExportCount: taskExports.length,
      productRequirementCount: insights.filter((item) => item.annotation.productRequirement).length,
      sourceCount: insights.reduce((sum, item) => sum + item.sourceCount, 0),
      repeatedSignalCount: insights.reduce((sum, item) => sum + item.repeatedSignalCount, 0),
      qualityGateCounts: countBy(insights.map((item) => item.annotation.qualityGate.status)),
      audienceCounts: countBy(insights.map((item) => item.annotation.audience)),
      requirementTypeCounts: countBy(insights.map((item) => item.annotation.requirementType)),
      layerCounts: countBy(insights.map((item) => item.annotation.signalLayer)),
      domainCounts: countBy(insights.flatMap((item) => item.annotation.domains)),
      topRequirements: requirementQueue.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        score: item.score,
        priority: item.priority,
        href: item.href,
        fleetTarget: item.fleetTarget
          ? {
              productSlug: item.fleetTarget.productSlug,
              productName: item.fleetTarget.productName,
              action: item.fleetTarget.action,
              fitScore: item.fleetTarget.fitScore,
            }
          : null,
      })),
      taskExports: input.includeTasks ? taskExports : [],
    });
  }
  const totals = days.reduce(
    (acc, day) => ({
      broadInsights: acc.broadInsights + day.broadInsightCount,
      requirements: acc.requirements + day.requirementCount,
      taskExports: acc.taskExports + day.taskExportCount,
      productRequirements: acc.productRequirements + day.productRequirementCount,
      sourceCount: acc.sourceCount + day.sourceCount,
      repeatedSignalCount: acc.repeatedSignalCount + day.repeatedSignalCount,
    }),
    {
      broadInsights: 0,
      requirements: 0,
      taskExports: 0,
      productRequirements: 0,
      sourceCount: 0,
      repeatedSignalCount: 0,
    }
  );
  return {
    requestedFrom: range.requestedFrom,
    requestedTo: range.requestedTo,
    from: range.from,
    to: range.to,
    daysRequested: range.daysRequested,
    daysReturned: days.length,
    acceptedDateCount: availableDates.length,
    filters: input.filters,
    totals,
    days,
  } satisfies DailyRangeSummary;
}
