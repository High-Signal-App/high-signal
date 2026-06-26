import marketWatchConfig from '../../../../data/personal-market-watch.json';
import bundledMarketRefreshes from '../data/market-refreshes.json';
import { countBy, hoursSince } from '@high-signal/shared';
import type {
  MarketRefreshGroup,
  MarketRefreshRecord,
  MarketWatchConfig,
} from '@high-signal/shared';

export type MarketWatchFreshness = 'fresh' | 'stale' | 'empty';

export type MarketWatchSnapshot = {
  generatedAt: string;
  source: 'yahoo' | 'stooq';
  sourceUrl: string;
  description: string;
  configUpdatedAt: string;
  requestedDate: string | null;
  selectedRefreshDate: string | null;
  sourceDateShifted: boolean;
  latestRefreshAt: string | null;
  selectedRefreshAt: string | null;
  freshnessStatus: MarketWatchFreshness;
  freshnessHours: number | null;
  groupCount: number;
  quoteCount: number;
  nationalGroupCount: number;
  internationalGroupCount: number;
  directionCounts: Array<{ k: string; n: number }>;
  groups: MarketRefreshGroup[];
  history: MarketRefreshRecord[];
};

function latestMarketRefresh(records: MarketRefreshRecord[]) {
  return records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function refreshDate(record: MarketRefreshRecord) {
  return record.createdAt.slice(0, 10);
}

export function marketRefreshDates(records = bundledMarketRefreshes as MarketRefreshRecord[]) {
  return Array.from(new Set(records.map(refreshDate))).sort((a, b) => b.localeCompare(a));
}

export function resolveMarketRefreshRecord(
  records: MarketRefreshRecord[],
  preferredDate?: string | null
) {
  const sorted = records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!sorted.length) return null;
  if (!preferredDate) return sorted[0] ?? null;
  return (
    sorted.find((record) => refreshDate(record) === preferredDate) ??
    sorted.find((record) => refreshDate(record) < preferredDate) ??
    sorted.at(-1) ??
    null
  );
}

export function marketDirectionTone(direction: string) {
  if (direction === 'risk-on') return 'text-emerald-300';
  if (direction === 'risk-off') return 'text-rose-300';
  return 'text-zinc-300';
}

export function formatMarketPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function buildMarketWatchSnapshot(
  now = new Date(),
  preferredDate?: string | null
): MarketWatchSnapshot {
  const config = marketWatchConfig as MarketWatchConfig;
  const history = (bundledMarketRefreshes as MarketRefreshRecord[])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = latestMarketRefresh(history);
  const selected = resolveMarketRefreshRecord(history, preferredDate);
  const latestRefreshAt = latest?.createdAt ?? null;
  const selectedRefreshAt = selected?.createdAt ?? null;
  const selectedRefreshDate = selectedRefreshAt?.slice(0, 10) ?? null;
  const freshnessHours = hoursSince(now, latestRefreshAt);
  const groups = selected?.groups ?? [];
  return {
    generatedAt: now.toISOString(),
    source: selected?.source ?? latest?.source ?? 'yahoo',
    sourceUrl: 'https://finance.yahoo.com/',
    description: config.description,
    configUpdatedAt: config.updatedAt,
    requestedDate: preferredDate ?? null,
    selectedRefreshDate,
    sourceDateShifted: Boolean(
      preferredDate && selectedRefreshDate && selectedRefreshDate !== preferredDate
    ),
    latestRefreshAt,
    selectedRefreshAt,
    freshnessStatus: freshnessHours === null ? 'empty' : freshnessHours <= 36 ? 'fresh' : 'stale',
    freshnessHours,
    groupCount: groups.length,
    quoteCount: groups.reduce((sum, group) => sum + group.quotes.length, 0),
    nationalGroupCount: groups.filter((group) => group.region === 'national').length,
    internationalGroupCount: groups.filter((group) => group.region === 'international').length,
    directionCounts: countBy(groups.map((group) => group.direction)),
    groups,
    history,
  };
}
