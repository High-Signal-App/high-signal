export interface StockExplorerRow {
  id: string;
  symbol: string;
  name: string | null;
  ticker: string;
  isin: string;
  series: string;
  instrumentId: string;
  deleted: boolean;
  testInstrument: boolean;
  identifierValid: boolean;
  close: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  previousClose: string | null;
  volume: string | null;
  turnover: string | null;
  trades: string | null;
  inputSnapshotId: string;
}
export interface StockExplorerPacket {
  contractVersion: 'stock-data.dashboard-preview.v1';
  snapshotId: string;
  tradeDate: string;
  availableAt: string;
  extractorVersion: string;
  counts: { securities: number; observations: number; withoutObservation: number };
  sourceUrls: Record<string, string>;
  sourceSha256: Record<string, string>;
  rights: { publicDisplay: string; export: string };
  freshness: { status: string };
  rows: StockExplorerRow[];
}
export interface StockExplorerQuery {
  q?: string | string[];
  series?: string | string[];
  prices?: string | string[];
  listing?: string | string[];
  sort?: string | string[];
  dir?: string | string[];
  page?: string | string[];
}
export const STOCK_PAGE_SIZE = 50;
function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
function filtersFor(query: StockExplorerQuery) {
  const prices = first(query.prices);
  return {
    q: first(query.q),
    series: first(query.series) || 'EQ',
    prices: ['all', 'missing'].includes(prices) ? prices : 'reported',
    listing: first(query.listing) === 'all' ? 'all' : 'current',
  };
}
type Filters = ReturnType<typeof filtersFor>;
function matches(row: StockExplorerRow, filters: Filters) {
  if (filters.series !== 'all' && row.series !== filters.series) return false;
  if (filters.listing === 'current' && (row.deleted || row.testInstrument || !row.identifierValid))
    return false;
  if (filters.prices === 'missing' && row.close !== null) return false;
  if (filters.prices === 'reported' && row.close === null) return false;
  const search = filters.q.trim().toLocaleLowerCase();
  return (
    !search ||
    [row.symbol, row.name, row.isin].some((value) => value?.toLocaleLowerCase().includes(search))
  );
}
function compareRows(
  a: StockExplorerRow,
  b: StockExplorerRow,
  key: 'symbol' | 'close' | 'volume',
  direction: number
) {
  const av = a[key],
    bv = b[key];
  if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
  if (bv === null) return -1;
  const order = key === 'symbol' ? av.localeCompare(bv) : Number(av) - Number(bv);
  return order * direction || a.id.localeCompare(b.id);
}
export function stockExplorerPage(packet: StockExplorerPacket, query: StockExplorerQuery) {
  const filters = filtersFor(query);
  const filtered = packet.rows.filter((row) => matches(row, filters));
  const requestedSort = first(query.sort);
  const key = requestedSort === 'close' || requestedSort === 'volume' ? requestedSort : 'symbol';
  const direction = first(query.dir) === 'desc' ? -1 : 1;
  filtered.sort((a, b) => compareRows(a, b, key, direction));
  const requestedPage = Number(first(query.page));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.max(
        0,
        Math.min(requestedPage, Math.max(0, Math.ceil(filtered.length / STOCK_PAGE_SIZE) - 1))
      )
    : 0;
  return {
    rows: filtered.slice(page * STOCK_PAGE_SIZE, (page + 1) * STOCK_PAGE_SIZE),
    rowCount: filtered.length,
    page,
    filters,
    sort: [{ id: key, desc: direction === -1 }],
    series: [...new Set(packet.rows.map((row) => row.series))].sort(),
  };
}
