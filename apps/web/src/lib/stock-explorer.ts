interface ReportedNetAssets {
  modelVersion: string;
  asOf: string;
  ratio: string | null;
  marketCap: string | null;
  reportedNetAssets: string | null;
  rankingEligible: boolean;
  reason: string | null;
  statementDate?: string;
  statementBasis?: string;
  availableAt?: string;
  priceDate?: string;
  assets?: string;
  externalLiabilities?: string;
  reportedEquity?: string;
  parentEquity?: string | null;
  noncontrollingInterests?: string | null;
  verifiedShares?: string | null;
  inputIds?: string[];
  resultId?: string;
  warnings?: string[];
  evidence?: { id: string; url: string; sha256: string; available_at: string };
}
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
  financials?: ReportedNetAssets | null;
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
  financialCoverage?: {
    supportedRatios: number;
    rankingEligible: number;
    statementIdentities: number;
    filingFailures: number;
    indexPages: number;
    reasons: Record<string, number>;
  };
  financialSnapshotId?: string;
  financialAsOf?: string;
  universeAudit?: {
    listedEquityEntries: number;
    matched: number;
    references: {
      market: string;
      url: string;
      sha256: string;
      listedBySession: number;
      matched: number;
    }[];
  };
  rows: StockExplorerRow[];
}
export interface StockExplorerQuery {
  q?: string | string[];
  series?: string | string[];
  prices?: string | string[];
  listing?: string | string[];
  ratios?: string | string[];
  sort?: string | string[];
  dir?: string | string[];
  page?: string | string[];
}
export const STOCK_PAGE_SIZE = 50;
const EQUITY_SERIES = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST', 'SZ']);
/** Same conservative weekday publication deadline as the canonical NSE collector. */
export function stockPreviewFreshness(tradeDate: string, now = new Date()) {
  const local = new Date(now.getTime() + 330 * 60_000);
  const today = local.toISOString().slice(0, 10);
  const expected = new Date(local);
  if ([0, 6].includes(local.getUTCDay()) || local.getUTCHours() < 19) {
    do {
      expected.setUTCDate(expected.getUTCDate() - 1);
    } while ([0, 6].includes(expected.getUTCDay()));
  }
  const expectedSession = expected.toISOString().slice(0, 10);
  return {
    status: expectedSession <= tradeDate && tradeDate <= today ? 'fresh' : 'stale',
    expectedSession,
    observedSession: tradeDate,
    basis: 'weekday publication deadline; holidays unconfirmed; never relabel a prior session',
  };
}
function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
function filtersFor(query: StockExplorerQuery) {
  const prices = first(query.prices);
  return {
    q: first(query.q),
    series: first(query.series) || 'stocks',
    prices: ['reported', 'missing'].includes(prices) ? prices : 'all',
    ratios: ['available', 'missing', 'low'].includes(first(query.ratios))
      ? first(query.ratios)
      : 'all',
    listing: first(query.listing) === 'all' ? 'all' : 'current',
  };
}
type Filters = ReturnType<typeof filtersFor>;
function matchesRatio(row: StockExplorerRow, filter: string, priceStale: boolean) {
  const ratio = row.financials?.ratio ?? null;
  if (filter === 'available' && ratio === null) return false;
  if (filter === 'missing' && ratio !== null) return false;
  if (
    filter === 'low' &&
    (ratio === null ||
      Number(ratio) <= 0 ||
      Number(ratio) >= 1 ||
      !row.financials?.rankingEligible ||
      priceStale)
  )
    return false;
  return true;
}
function matches(row: StockExplorerRow, filters: Filters, priceStale: boolean) {
  if (filters.series === 'stocks' && (!EQUITY_SERIES.has(row.series) || !/^IN[E9]/.test(row.isin)))
    return false;
  if (!['all', 'stocks'].includes(filters.series) && row.series !== filters.series) return false;
  if (filters.listing === 'current' && (row.deleted || row.testInstrument || !row.identifierValid))
    return false;
  if (filters.prices === 'missing' && row.close !== null) return false;
  if (filters.prices === 'reported' && row.close === null) return false;
  if (!matchesRatio(row, filters.ratios, priceStale)) return false;
  const search = filters.q.trim().toLocaleLowerCase();
  return (
    !search ||
    [row.symbol, row.name, row.isin].some((value) => value?.toLocaleLowerCase().includes(search))
  );
}
function compareRows(
  a: StockExplorerRow,
  b: StockExplorerRow,
  key: 'symbol' | 'close' | 'volume' | 'marketCap' | 'reportedNetAssets' | 'ratio',
  direction: number
) {
  const av = ['marketCap', 'reportedNetAssets', 'ratio'].includes(key)
      ? (a.financials?.[key as 'marketCap' | 'reportedNetAssets' | 'ratio'] ?? null)
      : a[key as 'symbol' | 'close' | 'volume'],
    bv = ['marketCap', 'reportedNetAssets', 'ratio'].includes(key)
      ? (b.financials?.[key as 'marketCap' | 'reportedNetAssets' | 'ratio'] ?? null)
      : b[key as 'symbol' | 'close' | 'volume'];
  if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
  if (bv === null) return -1;
  const order = key === 'symbol' ? av.localeCompare(bv) : Number(av) - Number(bv);
  return order * direction || a.id.localeCompare(b.id);
}
export function stockExplorerPage(packet: StockExplorerPacket, query: StockExplorerQuery) {
  const filters = filtersFor(query);
  const selection = { ...filters, q: '', prices: 'all', ratios: 'all' };
  let filtered = packet.rows.filter((row) =>
    matches(row, selection, packet.freshness?.status === 'stale')
  );
  if (filters.series === 'stocks') {
    const listings = new Map<string, StockExplorerRow>();
    for (const row of filtered) {
      const previous = listings.get(row.isin);
      const priority = (item: StockExplorerRow) =>
        `${item.close === null ? '1' : '0'}${item.series === 'EQ' ? '0' : item.series === 'SM' ? '1' : '2'}${item.id}`;
      if (!previous || priority(row) < priority(previous)) listings.set(row.isin, row);
    }
    filtered = [...listings.values()];
  }
  filtered = filtered.filter((row) => matches(row, filters, packet.freshness?.status === 'stale'));
  const requestedSort = first(query.sort);
  const key = ['close', 'volume', 'marketCap', 'reportedNetAssets', 'ratio'].includes(requestedSort)
    ? (requestedSort as 'close' | 'volume' | 'marketCap' | 'reportedNetAssets' | 'ratio')
    : 'symbol';
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
    rows: filtered
      .slice(page * STOCK_PAGE_SIZE, (page + 1) * STOCK_PAGE_SIZE)
      .map((row) =>
        packet.freshness?.status === 'stale' && row.financials
          ? { ...row, financials: { ...row.financials, rankingEligible: false } }
          : row
      ),
    rowCount: filtered.length,
    page,
    filters,
    sort: [{ id: key, desc: direction === -1 }],
    series: [...new Set(packet.rows.map((row) => row.series))].sort(),
  };
}
