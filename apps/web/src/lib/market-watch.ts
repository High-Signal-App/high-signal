import marketWatchConfig from "../../../../data/personal-market-watch.json";
import bundledMarketRefreshes from "../data/market-refreshes.json";
import type { MarketRefreshGroup, MarketRefreshRecord, MarketWatchConfig } from "@high-signal/shared";

export type MarketWatchFreshness = "fresh" | "stale" | "empty";

export type MarketWatchSnapshot = {
  generatedAt: string;
  source: "stooq";
  sourceUrl: "https://stooq.com/";
  description: string;
  configUpdatedAt: string;
  latestRefreshAt: string | null;
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

function hoursSince(now: Date, iso: string | null) {
  if (!iso) return null;
  const value = (now.getTime() - new Date(iso).getTime()) / 36e5;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value * 10) / 10);
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

export function marketDirectionTone(direction: string) {
  if (direction === "risk-on") return "text-emerald-300";
  if (direction === "risk-off") return "text-rose-300";
  return "text-zinc-300";
}

export function formatMarketPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function buildMarketWatchSnapshot(now = new Date()): MarketWatchSnapshot {
  const config = marketWatchConfig as MarketWatchConfig;
  const history = (bundledMarketRefreshes as MarketRefreshRecord[]).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = latestMarketRefresh(history);
  const latestRefreshAt = latest?.createdAt ?? null;
  const freshnessHours = hoursSince(now, latestRefreshAt);
  const groups = latest?.groups ?? [];
  return {
    generatedAt: now.toISOString(),
    source: "stooq",
    sourceUrl: "https://stooq.com/",
    description: config.description,
    configUpdatedAt: config.updatedAt,
    latestRefreshAt,
    freshnessStatus: freshnessHours === null ? "empty" : freshnessHours <= 36 ? "fresh" : "stale",
    freshnessHours,
    groupCount: groups.length,
    quoteCount: groups.reduce((sum, group) => sum + group.quotes.length, 0),
    nationalGroupCount: groups.filter((group) => group.region === "national").length,
    internationalGroupCount: groups.filter((group) => group.region === "international").length,
    directionCounts: countBy(groups.map((group) => group.direction)),
    groups,
    history,
  };
}
