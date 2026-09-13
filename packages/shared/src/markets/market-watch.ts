export type MarketWatchRegion = 'national' | 'international';
export type MarketWatchDirection = 'risk-on' | 'risk-off' | 'mixed';

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
  source: 'yahoo' | 'stooq';
  createdAt: string;
  groups: MarketRefreshGroup[];
}

export function marketDirection(averageChangePct: number): MarketWatchDirection {
  if (averageChangePct >= 0.6) return 'risk-on';
  if (averageChangePct <= -0.6) return 'risk-off';
  return 'mixed';
}
