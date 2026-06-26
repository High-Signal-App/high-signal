import equitiesSnapshot from '../data/equities-snapshot.json';

export interface EquityRow {
  ticker: string;
  symbol?: string;
  exchange?: string;
  name?: string | null;
  asset_class?: string;
  currency?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  last_close?: number | null;
  last_date?: number | null;
  ret_1d?: number | null;
  ret_30d?: number | null;
  ret_90d?: number | null;
  ret_1y?: number | null;
  ret_5y?: number | null;
  ret_1d_usd?: number | null;
  ret_30d_usd?: number | null;
  ret_90d_usd?: number | null;
  ret_1y_usd?: number | null;
  ret_5y_usd?: number | null;
  volume_avg_30d?: number | null;
  volatility_30d?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  dist_to_52w_high?: number | null;
  dist_to_52w_low?: number | null;
  max_drawdown_1y?: number | null;
  max_drawdown_5y?: number | null;
  sma_50?: number | null;
  sma_200?: number | null;
  golden_cross?: boolean;
  death_cross?: boolean;
  beta_vs_spy?: number | null;
  rel_strength_spy_90d?: number | null;
}

export interface EquitiesSnapshotBundle {
  source: string;
  generatedAt: string;
  universeSize: number;
  rowsWithData: number;
  rows: EquityRow[];
}

const bundle = equitiesSnapshot as EquitiesSnapshotBundle;

export type SortKey =
  | 'ticker'
  | 'name'
  | 'sector'
  | 'country'
  | 'asset_class'
  | 'ret_1d'
  | 'ret_30d'
  | 'ret_90d'
  | 'ret_1y'
  | 'ret_5y'
  | 'volatility_30d'
  | 'last_close'
  | 'dist_to_52w_high'
  | 'max_drawdown_1y'
  | 'beta_vs_spy';

export type SortDir = 'asc' | 'desc';

const DEFAULT_SORT: SortKey = 'ret_30d';
const DEFAULT_DIR: SortDir = 'desc';

function compareNullable<T>(a: T | null | undefined, b: T | null | undefined, dir: SortDir) {
  // Nulls always sort last regardless of direction.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return dir === 'asc' ? a - b : b - a;
  }
  const as = String(a);
  const bs = String(b);
  return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
}

export function sortRows(
  rows: EquityRow[],
  key: SortKey = DEFAULT_SORT,
  dir: SortDir = DEFAULT_DIR
) {
  const out = [...rows];
  out.sort((a, b) =>
    compareNullable(a[key as keyof EquityRow] as never, b[key as keyof EquityRow] as never, dir)
  );
  return out;
}

export interface EquityFilters {
  country?: string | null;
  sector?: string | null;
  assetClass?: string | null;
  search?: string | null;
}

export function filterRows(rows: EquityRow[], filters: EquityFilters = {}): EquityRow[] {
  const search = filters.search?.toLowerCase().trim() ?? '';
  return rows.filter((row) => {
    if (filters.country && row.country !== filters.country) return false;
    if (filters.sector && row.sector !== filters.sector) return false;
    if (filters.assetClass && row.asset_class !== filters.assetClass) return false;
    if (search) {
      const hay = `${row.ticker} ${row.symbol ?? ''} ${row.name ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function uniqueValues(rows: EquityRow[], field: keyof EquityRow): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const v = row[field];
    if (typeof v === 'string' && v.trim()) set.add(v);
  }
  return Array.from(set).sort();
}

export function loadEquitiesBundle(): EquitiesSnapshotBundle {
  return bundle;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1000) return value.toFixed(0);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

export function moveTone(value: number | null | undefined): string {
  if (value == null) return 'text-zinc-500';
  if (value > 0.05) return 'text-emerald-300';
  if (value > 0) return 'text-emerald-400/70';
  if (value < -0.05) return 'text-red-300';
  if (value < 0) return 'text-red-400/70';
  return 'text-zinc-400';
}
