import type { IdeaFlowEvidence } from "../ideas/idea-intelligence";

export type MarketWatchRegion = "national" | "international";
export type MarketWatchDirection = "risk-on" | "risk-off" | "mixed";

export interface MarketWatchTicker {
  symbol: string;
  name: string;
  ticker: string;
  role: string;
}

export interface MarketWatchGroup {
  id: string;
  title: string;
  region: MarketWatchRegion;
  thesis: string;
  productImplication: string;
  tickers: MarketWatchTicker[];
}

export interface MarketWatchConfig {
  updatedAt: string;
  description: string;
  groups: MarketWatchGroup[];
}

export interface MarketQuote {
  symbol: string;
  name: string;
  role: string;
  ticker: string;
  date: string;
  time: string;
  open: number;
  close: number;
  changePct: number;
  volume: number;
}

export interface MarketRefreshGroup {
  id: string;
  title: string;
  region: MarketWatchRegion;
  thesis: string;
  productImplication: string;
  direction: MarketWatchDirection;
  averageChangePct: number;
  quotes: MarketQuote[];
}

export interface MarketRefreshRecord {
  source: "yahoo" | "stooq";
  createdAt: string;
  groups: MarketRefreshGroup[];
}

export function marketDirection(averageChangePct: number): MarketWatchDirection {
  if (averageChangePct >= 0.6) return "risk-on";
  if (averageChangePct <= -0.6) return "risk-off";
  return "mixed";
}

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function topMovers(quotes: MarketQuote[]) {
  return quotes
    .slice()
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3)
    .map((quote) => `${quote.symbol} ${formatPct(quote.changePct)}`)
    .join(", ");
}

export function evidenceFromMarketWatchConfig(config: MarketWatchConfig): IdeaFlowEvidence[] {
  return config.groups.map((group) => ({
    id: `market-watch-${group.id}`,
    source: "market" as const,
    title: `${group.title}: product timing thesis`,
    summary: `${group.thesis} Product implication: ${group.productImplication}`,
    href: `/markets#${group.id}`,
    observedAt: config.updatedAt,
    confidence: "medium" as const,
  }));
}

export function evidenceFromMarketRefreshes(records: MarketRefreshRecord[]): IdeaFlowEvidence[] {
  const latest = records
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return [];
  return latest.groups.map((group) => {
    const movers = topMovers(group.quotes);
    return {
      id: `market-refresh-${group.id}-${latest.createdAt}`,
      source: "market" as const,
      title: `${group.title}: ${group.direction} ${formatPct(group.averageChangePct)}`,
      summary: `${group.productImplication} Latest high-level move: ${movers || "no usable quotes"}.`,
      href: `/markets#${group.id}`,
      observedAt: latest.createdAt,
      confidence: group.quotes.length >= 3 ? ("high" as const) : ("medium" as const),
    };
  });
}
