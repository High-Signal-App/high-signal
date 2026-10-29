import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  marketDirection,
  type MarketQuote,
  type MarketRefreshRecord,
  type MarketWatchConfig,
  type MarketWatchGroup,
} from '@high-signal/shared';

import {
  publicStockPrices,
  stockPriceDate,
  stockPriceFreshness,
} from '../packages/shared/src/stock-data';
import { loadStockPrices, publishStockPriceStatus } from './stock-data-read';

type EquitySnapshotRow = {
  ticker: string;
  inputSnapshotId?: string;
  symbol?: string | null;
  last_close?: number | null;
  last_date?: number | null;
  ret_1d?: number | null;
  volume_avg_30d?: number | null;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_WATCH_PATH = resolve(ROOT, 'data/personal-market-watch.json');
const MARKET_REFRESH_PATH = resolve(ROOT, 'data/personal-market-refresh.jsonl');
const EQUITIES_SNAPSHOT_PATH = resolve(ROOT, 'data/stock-data-prices.json');

async function readEquitiesSnapshot() {
  const dataset = await loadStockPrices();
  const rows = publicStockPrices(dataset);
  const byTicker = new Map<string, EquitySnapshotRow>();
  const bySymbol = new Map<string, EquitySnapshotRow>();
  for (const row of rows) {
    if (row.ticker) byTicker.set(row.ticker, row);
    if (row.symbol && !bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
  }
  return { byTicker, bySymbol, dataset };
}

function quoteFromSnapshot(
  ticker: MarketWatchGroup['tickers'][number],
  snapshots: Awaited<ReturnType<typeof readEquitiesSnapshot>>
): MarketQuote | null {
  const row = snapshots.byTicker.get(ticker.ticker) ?? snapshots.bySymbol.get(ticker.symbol);
  if (
    !row ||
    typeof row.last_close !== 'number' ||
    typeof row.ret_1d !== 'number' ||
    stockPriceFreshness(row) !== 'fresh'
  )
    return null;
  const changePct = row.ret_1d * 100;
  const previousClose =
    typeof row.ret_1d === 'number' && row.ret_1d > -1 ? row.last_close / (1 + row.ret_1d) : null;
  return {
    symbol: ticker.symbol,
    name: ticker.name,
    role: ticker.role,
    ticker: ticker.ticker,
    date: stockPriceDate(row)!,
    inputSnapshotId: row.inputSnapshotId,
    time: 'eod',
    open: null,
    previousClose,
    priceBasis: 'total_return_adjusted',
    close: row.last_close,
    changePct,
    volume: row.volume_avg_30d ?? null,
    volumeBasis: 'average_30d',
  };
}

async function main() {
  const [config, snapshots] = await Promise.all([
    readFile(MARKET_WATCH_PATH, 'utf8').then((raw) => JSON.parse(raw) as MarketWatchConfig),
    readEquitiesSnapshot(),
  ]);
  if (!(await publishStockPriceStatus(snapshots.dataset))) return;
  const groups = config.groups.map((group) => {
    const quotes = group.tickers
      .map((ticker) => quoteFromSnapshot(ticker, snapshots))
      .filter((quote): quote is MarketQuote => Boolean(quote));
    const averageChangePct = quotes.length
      ? quotes.reduce((sum, quote) => sum + quote.changePct, 0) / quotes.length
      : null;
    return {
      id: group.id,
      coverage:
        quotes.length === 0
          ? ('unavailable' as const)
          : quotes.length === group.tickers.length
            ? ('complete' as const)
            : ('partial' as const),
      missingTickers: group.tickers
        .filter((ticker) => !quotes.some((quote) => quote.ticker === ticker.ticker))
        .map((ticker) => ticker.ticker),
      title: group.title,
      region: group.region,
      thesis: group.thesis,
      productImplication: group.productImplication,
      direction: marketDirection(averageChangePct),
      averageChangePct,
      quotes,
    };
  });
  const record: MarketRefreshRecord = {
    source: 'yahoo',
    createdAt: new Date().toISOString(),
    inputSnapshotId: snapshots.dataset.snapshotId,
    coverage: snapshots.dataset.completeness,
    groups,
  };
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) await appendFile(MARKET_REFRESH_PATH, `${JSON.stringify(record)}\n`);
  console.log(
    JSON.stringify({
      source: EQUITIES_SNAPSHOT_PATH,
      output: MARKET_REFRESH_PATH,
      dryRun,
      groups: groups.length,
      quotes: groups.reduce((sum, group) => sum + group.quotes.length, 0),
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
