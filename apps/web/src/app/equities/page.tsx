import { Button } from '@saas-maker/ui/components/button';
import { Input } from '@saas-maker/ui/components/input';
import { EmptyState } from '@saas-maker/ui/components/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@saas-maker/ui/components/table';
import {
  StockPanel as Panel,
  StockStats as StatGrid,
  StockSelect,
} from '@/components/organisms/StockDataUI';
import { StockDataCoverage } from '@/components/organisms/StockDataCoverage';
import { stockPriceDisplayStatus } from '../../../../../packages/shared/src/stock-data/price-status';
import { withAgentMetadata } from '@/lib/agent-page-metadata';
import { BackLink, PageShell, SectionHeader } from '@/components/system/HighSignalUI';
import {
  filterRows,
  formatPct,
  formatPrice,
  loadEquitiesBundle,
  moveTone,
  sortRows,
  uniqueValues,
  type SortDir,
  type SortKey,
} from '@/lib/equities';
import { StockDataPanel } from '@/components/organisms/StockDataPanel';

export const dynamic = 'force-dynamic';
export const metadata = withAgentMetadata({ title: 'Equities Snapshot' }, '/equities');

const SORT_KEYS = new Set<SortKey>([
  'ticker',
  'name',
  'sector',
  'country',
  'asset_class',
  'ret_1d',
  'ret_30d',
  'ret_90d',
  'ret_1y',
  'ret_5y',
  'volatility_30d',
  'last_close',
  'dist_to_52w_high',
  'max_drawdown_1y',
  'beta_vs_spy',
]);

function parseSort(value: string | undefined): SortKey {
  return value && SORT_KEYS.has(value as SortKey) ? (value as SortKey) : 'ret_30d';
}

function parseDir(value: string | undefined): SortDir {
  return value === 'asc' ? 'asc' : 'desc';
}

function toggleDir(currentKey: SortKey, key: SortKey, currentDir: SortDir): SortDir {
  if (currentKey !== key) return 'desc';
  return currentDir === 'desc' ? 'asc' : 'desc';
}

function sortLink(
  sortKey: SortKey,
  thisKey: SortKey,
  currentDir: SortDir,
  preserve: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(preserve)) {
    if (v) params.set(k, v);
  }
  params.set('sort', thisKey);
  params.set('dir', toggleDir(sortKey, thisKey, currentDir));
  return `/equities?${params.toString()}`;
}

function indicator(sortKey: SortKey, thisKey: SortKey, dir: SortDir) {
  if (sortKey !== thisKey) return '';
  return dir === 'desc' ? ' ↓' : ' ↑';
}

interface SearchParams {
  company?: string;
  coverage?: string;
  freshness?: string;
  sort?: string;
  dir?: string;
  country?: string;
  sector?: string;
  assetClass?: string;
  q?: string;
}

export default async function EquitiesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const sortKey = parseSort(params.sort);
  const sortDir = parseDir(params.dir);
  const bundle = loadEquitiesBundle();

  const filtered = filterRows(bundle.rows, {
    country: params.country || null,
    sector: params.sector || null,
    assetClass: params.assetClass || null,
    search: params.q || null,
  });
  const rows = sortRows(filtered, sortKey, sortDir);

  const countries = uniqueValues(bundle.rows, 'country');
  const sectors = uniqueValues(bundle.rows, 'sector');
  const assetClasses = uniqueValues(bundle.rows, 'asset_class');

  const preserve = {
    country: params.country,
    sector: params.sector,
    assetClass: params.assetClass,
    q: params.q,
  } as Record<string, string | undefined>;

  const generatedDisplay =
    bundle.generatedAt && bundle.generatedAt !== '1970-01-01T00:00:00.000Z'
      ? `${bundle.generatedAt.slice(0, 16).replace('T', ' ')} UTC`
      : 'no snapshot yet';

  return (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="market context" title="equities snapshot">
        Prices, ownership and valuation inputs from the shared stock-data layer. NSE cash-market
        files cover every source series; company models remain separately qualified.
      </SectionHeader>

      {!stockPriceDisplayStatus().permitted ? (
        <p className="my-5 border-l-2 border-amber-700 pl-4 text-sm text-amber-300">
          {stockPriceDisplayStatus().reason} Historical bundles are retained for verification.
        </p>
      ) : null}

      <StatGrid
        items={[
          {
            label: 'Generated',
            value: generatedDisplay,
            sub: 'canonical equities pipeline',
          },
          {
            label: 'Universe',
            value: stockPriceDisplayStatus().permitted
              ? String(bundle.universeSize)
              : 'Unavailable',
            sub: `${bundle.rowsWithData} with price data`,
          },
          {
            label: 'Showing',
            value: String(rows.length),
            sub: filterActive(preserve) ? 'filtered' : 'all rows',
          },
        ]}
      />

      <StockDataCoverage />
      {process.env['NODE_ENV'] === 'development' && process.env['NSE_DASHBOARD_PREVIEW_ROOT'] ? (
        <Button asChild variant="outline">
          <a href="/equities/preview">Open local NSE data preview</a>
        </Button>
      ) : null}
      <StockDataPanel
        company={params.company}
        coverage={params.coverage}
        freshness={params.freshness}
      />

      <Panel eyebrow="filter" title="filter">
        <form method="get" action="/equities" className="flex flex-wrap gap-3 text-sm">
          <FilterSelect name="country" label="country" value={params.country} options={countries} />
          <FilterSelect name="sector" label="sector" value={params.sector} options={sectors} />
          <FilterSelect
            name="assetClass"
            label="asset class"
            value={params.assetClass}
            options={assetClasses}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[var(--color-muted)]">search</span>
            <Input
              type="text"
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="ticker or name"
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
            />
          </label>
          {/* preserve current sort across filter submits */}
          {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
          {params.dir ? <input type="hidden" name="dir" value={params.dir} /> : null}
          <Button type="submit" variant="outline" className="self-end">
            Apply
          </Button>
          {filterActive(preserve) ? (
            <a
              href="/equities"
              className="self-end rounded border border-transparent px-3 py-1 text-zinc-400 hover:text-zinc-200"
            >
              clear
            </a>
          ) : null}
        </form>
      </Panel>

      <Panel eyebrow="data" title={`Snapshot (${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState
            title="Price display unavailable"
            description="The private source archive is retained. Public prices are withheld until display permissions and freshness checks pass."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[1100px] border-collapse text-sm">
              <TableHeader className="text-xs tracking-wide text-[var(--color-muted)]">
                <TableRow className="border-b border-zinc-800">
                  <Th
                    label="Ticker"
                    thisKey="ticker"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                  />
                  <Th
                    label="Name"
                    thisKey="name"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                  />
                  <Th
                    label="Sector"
                    thisKey="sector"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                  />
                  <Th
                    label="Country"
                    thisKey="country"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                  />
                  <Th
                    label="Last"
                    thisKey="last_close"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="1d"
                    thisKey="ret_1d"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="30d"
                    thisKey="ret_30d"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="90d"
                    thisKey="ret_90d"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="1y"
                    thisKey="ret_1y"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="5y"
                    thisKey="ret_5y"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="Vol30"
                    thisKey="volatility_30d"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="vs 52wH"
                    thisKey="dist_to_52w_high"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="MaxDD1y"
                    thisKey="max_drawdown_1y"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                  <Th
                    label="β"
                    thisKey="beta_vs_spy"
                    sortKey={sortKey}
                    dir={sortDir}
                    preserve={preserve}
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.ticker}
                    className="border-b border-zinc-900 hover:bg-zinc-900/50"
                  >
                    <TableCell className="py-1.5 pr-3 font-mono text-zinc-100">
                      {r.ticker}
                    </TableCell>
                    <TableCell className="py-1.5 pr-3 text-zinc-300">{r.name ?? '—'}</TableCell>
                    <TableCell className="py-1.5 pr-3 text-zinc-400">{r.sector ?? '—'}</TableCell>
                    <TableCell className="py-1.5 pr-3 text-zinc-400">{r.country ?? '—'}</TableCell>
                    <TableCell className="py-1.5 pr-3 text-right font-mono text-zinc-200">
                      {formatPrice(r.last_close)}
                    </TableCell>
                    <TableCell className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.ret_1d)}`}>
                      {formatPct(r.ret_1d)}
                    </TableCell>
                    <TableCell
                      className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.ret_30d)}`}
                    >
                      {formatPct(r.ret_30d)}
                    </TableCell>
                    <TableCell
                      className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.ret_90d)}`}
                    >
                      {formatPct(r.ret_90d)}
                    </TableCell>
                    <TableCell className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.ret_1y)}`}>
                      {formatPct(r.ret_1y)}
                    </TableCell>
                    <TableCell className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.ret_5y)}`}>
                      {formatPct(r.ret_5y)}
                    </TableCell>
                    <TableCell className="py-1.5 pr-3 text-right font-mono text-zinc-400">
                      {formatPct(r.volatility_30d, 0)}
                    </TableCell>
                    <TableCell
                      className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.dist_to_52w_high)}`}
                    >
                      {formatPct(r.dist_to_52w_high)}
                    </TableCell>
                    <TableCell
                      className={`py-1.5 pr-3 text-right font-mono ${moveTone(r.max_drawdown_1y)}`}
                    >
                      {formatPct(r.max_drawdown_1y)}
                    </TableCell>
                    <TableCell className="py-1.5 pr-3 text-right font-mono text-zinc-400">
                      {r.beta_vs_spy == null ? '—' : r.beta_vs_spy.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}

function filterActive(preserve: Record<string, string | undefined>): boolean {
  return Boolean(
    preserve['country'] || preserve['sector'] || preserve['assetClass'] || preserve['q']
  );
}

function FilterSelect(props: { name: string; label: string; value?: string; options: string[] }) {
  return <StockSelect {...props} />;
}

function Th({
  label,
  thisKey,
  sortKey,
  dir,
  preserve,
  align,
}: {
  label: string;
  thisKey: SortKey;
  sortKey: SortKey;
  dir: SortDir;
  preserve: Record<string, string | undefined>;
  align?: 'right';
}) {
  return (
    <TableHead
      className={`py-2 pr-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <a href={sortLink(sortKey, thisKey, dir, preserve)} className="hover:text-zinc-200">
        {label}
        {indicator(sortKey, thisKey, dir)}
      </a>
    </TableHead>
  );
}
