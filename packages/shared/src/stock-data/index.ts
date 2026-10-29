type Coverage = 'complete' | 'partial' | 'unavailable';
export type Freshness = 'fresh' | 'stale' | 'unavailable';

export interface StockPriceRow {
  ticker: string;
  entityId: string;
  securityId: string;
  inputSnapshotId: string;
  inputSnapshotIds: string[];
  sourceRefs: { sourceId: string; url: string }[];
  completeness: Coverage;
  priceBasis: 'total_return_adjusted' | 'unadjusted';
  deleted?: boolean;
  testInstrument?: boolean;
  identifierValid?: boolean;
  symbol?: string;
  name?: string | null;
  exchange?: string;
  currency?: string | null;
  country?: string | null;
  sector?: string | null;
  asset_class?: string;
  last_close?: number | null;
  last_date?: number | null;
  ret_1d?: number | null;
  ret_30d?: number | null;
  ret_90d?: number | null;
  [key: string]: unknown;
}

export interface StockPriceDataset {
  contractVersion: 'stock-data.prices.v1';
  snapshotId: string;
  generatedAt: string;
  completeness: Coverage;
  historyAvailable: boolean;
  universeComplete?: boolean;
  nonNseUniverseComplete?: boolean;
  nseUniverseComplete?: boolean;
  coverage: Record<string, string>;
  rights: {
    publicDisplay: 'permitted' | 'prohibited' | 'unknown';
    export: 'permitted' | 'prohibited' | 'unknown';
    policyUrl: string;
  };
  rows: StockPriceRow[];
}

export function readStockPriceDataset(value: unknown): StockPriceDataset {
  if (!value || typeof value !== 'object') throw new Error('Missing stock-data contract');
  const dataset = value as StockPriceDataset;
  if (
    dataset.contractVersion !== 'stock-data.prices.v1' ||
    !dataset.snapshotId ||
    !Number.isFinite(Date.parse(dataset.generatedAt)) ||
    !Array.isArray(dataset.rows) ||
    !dataset.rights ||
    !['permitted', 'prohibited', 'unknown'].includes(dataset.rights.publicDisplay) ||
    !['permitted', 'prohibited', 'unknown'].includes(dataset.rights.export)
  ) {
    throw new Error('Unsupported or invalid stock-data contract');
  }
  for (const row of dataset.rows) validateStockPriceRow(row);
  return dataset;
}

function validateStockPriceRow(row: StockPriceRow) {
  if (
    !row.ticker ||
    !row.entityId ||
    !row.securityId ||
    !row.inputSnapshotId ||
    !Array.isArray(row.inputSnapshotIds) ||
    (row.last_close != null && !row.inputSnapshotIds.length) ||
    !Array.isArray(row.sourceRefs) ||
    !row.sourceRefs.length ||
    !['total_return_adjusted', 'unadjusted'].includes(row.priceBasis)
  )
    throw new Error('Untraceable stock price row');
  for (const metric of ['last_close', 'ret_1d', 'ret_30d', 'ret_90d']) {
    const number = row[metric];
    if (number != null && (typeof number !== 'number' || !Number.isFinite(number))) {
      throw new Error(`Invalid stock-data metric: ${metric}`);
    }
  }
}

export function stockPriceDate(row: Pick<StockPriceRow, 'last_date'>): string | null {
  if (!Number.isInteger(row.last_date) || !/^\d{8}$/.test(String(row.last_date))) return null;
  const value = String(row.last_date);
  const day = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
    ? day
    : null;
}

export function stockPriceFreshness(
  row: Pick<StockPriceRow, 'last_date'>,
  now = new Date()
): Freshness {
  const day = stockPriceDate(row);
  if (!day) return 'unavailable';
  const age = now.getTime() - Date.parse(`${day}T00:00:00Z`);
  if (age < 0) return 'unavailable';
  return age > 7 * 86_400_000 ? 'stale' : 'fresh';
}

export function publicStockPrices(dataset: StockPriceDataset): StockPriceRow[] {
  return dataset.rights.publicDisplay === 'permitted' ? dataset.rows : [];
}
