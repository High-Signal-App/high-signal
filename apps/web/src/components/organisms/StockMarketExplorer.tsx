'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@saas-maker/ui/components/button';
import { Badge } from '@saas-maker/ui/components/badge';
import { Input } from '@saas-maker/ui/components/input';
import { Label } from '@saas-maker/ui/components/label';
import { DataTable, type DataColumn, type DataSort } from '@saas-maker/ui/components/data-table';
import { EmptyState } from '@saas-maker/ui/components/empty-state';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@saas-maker/ui/components/sheet';
import { Ledger, StatusPill } from '@saas-maker/ui/blocks/proof';
import {
  STOCK_PAGE_SIZE,
  type StockExplorerPacket,
  type StockExplorerRow,
  type stockExplorerPage,
} from '@/lib/stock-explorer';
import { StockPanel, StockSelect, StockStats } from './StockDataUI';

const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
function amount(value: string | null) {
  return value === null ? 'Unavailable' : number.format(Number(value));
}
function price(value: string | null) {
  return value === null ? 'Unavailable' : currency.format(Number(value));
}
function day(value: string) {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const columns: DataColumn<StockExplorerRow>[] = [
  {
    id: 'symbol',
    header: 'Security',
    value: (row) => row.symbol,
    hideable: false,
    minWidth: '15rem',
    cell: (row) => (
      <div>
        <span className="font-mono text-sm font-medium">{row.symbol}</span>
        <div className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{row.name}</div>
      </div>
    ),
  },
  {
    id: 'series',
    header: 'Series',
    value: (row) => row.series,
    sortable: false,
    cell: (row) => <Badge variant="outline">{row.series}</Badge>,
  },
  {
    id: 'close',
    header: 'Close (INR)',
    value: (row) => (row.close === null ? null : Number(row.close)),
    align: 'right',
    minWidth: '9rem',
    cell: (row) => <span className="font-mono tabular-nums">{price(row.close)}</span>,
  },
  {
    id: 'volume',
    header: 'Volume',
    value: (row) => (row.volume === null ? null : Number(row.volume)),
    align: 'right',
    minWidth: '9rem',
    cell: (row) => <span className="font-mono tabular-nums">{amount(row.volume)}</span>,
  },
  {
    id: 'coverage',
    header: 'Price coverage',
    value: (row) => (row.close === null ? 'Not reported' : 'Reported'),
    sortable: false,
    cell: (row) => (
      <Badge variant="outline">{row.close === null ? 'Not reported' : 'Reported'}</Badge>
    ),
  },
];

type Summary = Omit<StockExplorerPacket, 'rows'>;
type View = ReturnType<typeof stockExplorerPage>;

export function StockMarketExplorer({ summary, view }: { summary: Summary; view: View }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = view.rows.find((row) => row.id === selectedId) ?? null;
  function navigate(page: number, sort: DataSort = view.sort) {
    const params = new URLSearchParams({
      ...view.filters,
      page: String(page),
      sort: sort[0]?.id ?? 'symbol',
      dir: sort[0]?.desc ? 'desc' : 'asc',
    });
    startTransition(() => router.replace(`/equities/preview?${params}`, { scroll: false }));
  }
  return (
    <>
      <ExplorerHeader summary={summary} />
      <StockPanel eyebrow="security explorer" title="Explore the retained market">
        <form
          method="get"
          action="/equities/preview"
          className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.4fr)_1fr_1fr_1fr_auto]"
        >
          <input type="hidden" name="sort" value={view.sort[0]?.id ?? 'symbol'} />
          <input type="hidden" name="dir" value={view.sort[0]?.desc ? 'desc' : 'asc'} />
          <div className="grid gap-2">
            <Label htmlFor="security-search" className="text-xs text-muted-foreground">
              Company, symbol or ISIN
            </Label>
            <Input
              id="security-search"
              type="search"
              name="q"
              defaultValue={view.filters.q}
              placeholder="Search the full master"
            />
          </div>
          <StockSelect
            name="series"
            label="Series"
            value={view.filters.series}
            allValue="all"
            allLabel="All series"
            options={view.series}
          />
          <StockSelect
            name="prices"
            label="Price coverage"
            value={view.filters.prices}
            allValue="all"
            allLabel="All price states"
            options={[
              { value: 'reported', label: 'Reported close' },
              { value: 'missing', label: 'No reported close' },
            ]}
          />
          <StockSelect
            name="listing"
            label="Master records"
            value={view.filters.listing}
            allValue="all"
            allLabel="All retained records"
            options={[{ value: 'current', label: 'Exclude deleted / test' }]}
          />
          <Button type="submit" variant="outline" className="self-end">
            Apply
          </Button>
        </form>
        <DataTable
          data={view.rows}
          columns={columns}
          getRowId={(row) => row.id}
          label="NSE retained securities"
          pageSize={STOCK_PAGE_SIZE}
          manual={{
            rowCount: view.rowCount,
            page: view.page,
            onPageChange: (page) => navigate(page),
          }}
          sort={view.sort}
          onSortChange={(sort) => navigate(0, sort)}
          onRowClick={(row) => setSelectedId(row.id)}
          selectedId={selectedId}
          status={pending ? 'loading' : 'ready'}
          maxHeight="34rem"
          empty={
            <EmptyState
              title="No securities match these filters"
              description="Try another symbol, series or price-coverage filter. Missing quotes are retained as unavailable."
            />
          }
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {number.format(view.rowCount)} matching records. Select a security or press Enter on its
          row to inspect the source evidence.
        </p>
      </StockPanel>
      <StockEvidence selected={selected} summary={summary} onClose={() => setSelectedId(null)} />
    </>
  );
}

function ExplorerHeader({ summary }: { summary: Summary }) {
  return (
    <>
      <header className="mt-8 border-b border-border pb-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Local preview</Badge>
          <span className="font-mono text-xs text-muted-foreground">NSE · CASH MARKET</span>
        </div>
        <h1 className="mt-4 text-3xl sm:text-4xl">Equity data, with the evidence.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          The full retained NSE security master and daily market report. Inspect source-backed
          prices now; ownership and valuation models remain separately qualified.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>
            Price session{' '}
            <strong className="font-normal text-foreground">{day(summary.tradeDate)}</strong>
          </span>
          <StatusPill tone={summary.freshness.status === 'stale' ? 'warning' : 'neutral'}>
            {summary.freshness.status === 'stale' ? 'Price session stale' : 'Retained session'}
          </StatusPill>
          <span>
            Public display / export: {summary.rights.publicDisplay} / {summary.rights.export}
          </span>
        </div>
      </header>
      <StockStats
        items={[
          {
            label: 'MASTER RECORDS',
            value: number.format(summary.counts.securities),
            sub: 'Every source series retained',
          },
          {
            label: 'DAILY OBSERVATIONS',
            value: number.format(summary.counts.observations),
            sub: 'From the final CM bhavcopy',
          },
          {
            label: 'NO DAILY OBSERVATION',
            value: number.format(summary.counts.withoutObservation),
            sub: 'Missing prices stay unavailable',
          },
          { label: 'NAV COVERAGE', value: 'Pending', sub: 'Ownership and net assets unqualified' },
        ]}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Master records include inactive, test and non-company instruments. This is not a count of
        active listed companies. Prices below are unadjusted; no action-adjusted returns or NAV
        rankings are inferred.
      </p>
    </>
  );
}

function StockEvidence({
  selected,
  summary,
  onClose,
}: {
  selected: StockExplorerRow | null;
  summary: Summary;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle>
            {selected?.symbol} · {selected?.series}
          </SheetTitle>
          <SheetDescription>
            {selected?.name}. Original observations for {day(summary.tradeDate)}; prices are
            unadjusted.
          </SheetDescription>
        </SheetHeader>
        {selected ? (
          <div className="space-y-5 px-4 pb-8">
            <Ledger
              title="Price and activity"
              variant="paper"
              rows={[
                { label: 'Close', value: price(selected.close) },
                { label: 'Open', value: price(selected.open) },
                { label: 'High / low', value: `${price(selected.high)} / ${price(selected.low)}` },
                { label: 'Previous close', value: price(selected.previousClose) },
                { label: 'Volume', value: amount(selected.volume) },
                { label: 'Turnover (INR)', value: amount(selected.turnover) },
                { label: 'Trade count', value: amount(selected.trades) },
              ]}
              footer="No reported observation means unavailable, never zero. A reported close does not establish an executed trade or an adjusted return."
            />
            <Ledger
              title="Identity and coverage"
              variant="paper"
              rows={[
                { label: 'ISIN', value: selected.isin || 'Unavailable' },
                { label: 'Instrument', value: selected.instrumentId },
                { label: 'Series', value: selected.series },
                {
                  label: 'Master deletion',
                  value: selected.deleted ? 'Deleted flag set' : 'Not deleted',
                },
                {
                  label: 'Identity',
                  value: 'Provisional listing identity; legal issuer mapping not qualified',
                },
                { label: 'NAV / ownership', value: 'Unavailable in the daily market dump' },
              ]}
            />
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Original exchange evidence</h3>
              {Object.entries(summary.sourceUrls).map(([name, url]) => (
                <Button key={name} asChild variant="outline" className="w-full justify-start">
                  <a href={url} target="_blank" rel="noreferrer">
                    {name === 'securities' ? 'Security master' : 'Final CM bhavcopy'} ↗
                  </a>
                </Button>
              ))}
              <p className="text-xs text-muted-foreground">
                Publicly observed {day(summary.availableAt)}. Local inspection does not grant public
                display or export permission.
              </p>
              <div className="space-y-2 break-all font-mono text-[10px] leading-5 text-muted-foreground">
                <p>Snapshot {summary.snapshotId}</p>
                <p>Retained row {selected.inputSnapshotId}</p>
                <p>Extractor {summary.extractorVersion}</p>
                {Object.entries(summary.sourceSha256).map(([name, hash]) => (
                  <p key={name}>
                    {name} SHA-256 {hash}
                  </p>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
