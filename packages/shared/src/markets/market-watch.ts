export type MarketWatchRegion = 'national' | 'international';
export type MarketWatchDirection = 'risk-on' | 'risk-off' | 'mixed' | 'unavailable';

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
  inputSnapshotId?: string;
  symbol: string;
  name: string;
  role: string;
  ticker: string;
  date: string;
  time: string;
  open: number | null;
  previousClose?: number | null;
  priceBasis?: 'total_return_adjusted';
  close: number;
  changePct: number;
  volume: number | null;
  volumeBasis?: 'average_30d';
}

export interface MarketRefreshGroup {
  coverage?: 'complete' | 'partial' | 'unavailable';
  missingTickers?: string[];
  id: string;
  title: string;
  region: MarketWatchRegion;
  thesis: string;
  productImplication: string;
  direction: MarketWatchDirection;
  averageChangePct: number | null;
  quotes: MarketQuote[];
}

export interface MarketRefreshRecord {
  inputSnapshotId?: string;
  coverage?: 'complete' | 'partial' | 'unavailable';
  source: 'yahoo' | 'stooq';
  createdAt: string;
  groups: MarketRefreshGroup[];
}

export function marketDirection(averageChangePct: number | null): MarketWatchDirection {
  if (averageChangePct === null) return 'unavailable';
  if (averageChangePct >= 0.6) return 'risk-on';
  if (averageChangePct <= -0.6) return 'risk-off';
  return 'mixed';
}
