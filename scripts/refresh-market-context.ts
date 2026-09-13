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

type EquitySnapshotRow = {
  ticker: string;
  symbol?: string | null;
  last_close?: number | null;
  last_date?: number | null;
  ret_1d?: number | null;
  volume_avg_30d?: number | null;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_WATCH_PATH = resolve(ROOT, 'data/personal-market-watch.json');
const MARKET_REFRESH_PATH = resolve(ROOT, 'data/personal-market-refresh.jsonl');
const EQUITIES_SNAPSHOT_PATH = resolve(ROOT, 'data/equities-snapshot.jsonl');

function dateFromSnapshot(value: number | null | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const raw = String(value);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

async function readEquitiesSnapshot() {
  const raw = await readFile(EQUITIES_SNAPSHOT_PATH, 'utf8');
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EquitySnapshotRow);
  const byTicker = new Map<string, EquitySnapshotRow>();
  const bySymbol = new Map<string, EquitySnapshotRow>();
  for (const row of rows) {
    if (row.ticker) byTicker.set(row.ticker, row);
    if (row.symbol && !bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
  }
  return { byTicker, bySymbol };
}

function quoteFromSnapshot(
  ticker: MarketWatchGroup['tickers'][number],
  snapshots: Awaited<ReturnType<typeof readEquitiesSnapshot>>
): MarketQuote | null {
  const row = snapshots.byTicker.get(ticker.ticker) ?? snapshots.bySymbol.get(ticker.symbol);
  if (!row || typeof row.last_close !== 'number') return null;
  const changePct = typeof row.ret_1d === 'number' ? row.ret_1d * 100 : 0;
  const open =
    typeof row.ret_1d === 'number' && row.ret_1d > -1
      ? row.last_close / (1 + row.ret_1d)
      : row.last_close;
  return {
    symbol: ticker.symbol,
    name: ticker.name,
    role: ticker.role,
    ticker: ticker.ticker,
    date: dateFromSnapshot(row.last_date),
    time: 'eod',
    open,
    close: row.last_close,
    changePct,
    volume: row.volume_avg_30d ?? 0,
  };
}

async function main() {
  const [config, snapshots] = await Promise.all([
    readFile(MARKET_WATCH_PATH, 'utf8').then((raw) => JSON.parse(raw) as MarketWatchConfig),
    readEquitiesSnapshot(),
  ]);
  const groups = config.groups.map((group) => {
    const quotes = group.tickers
      .map((ticker) => quoteFromSnapshot(ticker, snapshots))
      .filter((quote): quote is MarketQuote => Boolean(quote));
    const averageChangePct = quotes.length
      ? quotes.reduce((sum, quote) => sum + quote.changePct, 0) / quotes.length
      : 0;
    return {
      id: group.id,
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
