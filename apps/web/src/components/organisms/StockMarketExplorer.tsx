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
const compactINR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 2,
});
function balance(value: string | null | undefined) {
  return value == null ? 'Unavailable' : compactINR.format(Number(value));
}
function ratio(value: string | null | undefined) {
  return value == null ? 'Unavailable' : `${number.format(Number(value))}×`;
}
function reason(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ') : 'Financial filing unavailable';
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
    id: 'ratio',
    header: 'Market cap / reported net assets',
    value: (row) => (row.financials?.ratio == null ? null : Number(row.financials.ratio)),
    align: 'right',
    minWidth: '15rem',
    cell: (row) => (
      <div>
        <span className="font-mono tabular-nums">{ratio(row.financials?.ratio)}</span>
        <div className="mt-1 max-w-64 text-xs text-muted-foreground">
          {row.financials?.ratio == null
            ? reason(row.financials?.reason)
            : row.financials.rankingEligible
              ? 'Ratio available'
              : 'Historical inputs'}
        </div>
      </div>
    ),
  },
  {
    id: 'marketCap',
    header: 'Market cap (INR)',
    value: (row) => (row.financials?.marketCap == null ? null : Number(row.financials.marketCap)),
    align: 'right',
    minWidth: '11rem',
    cell: (row) => (
      <span className="font-mono tabular-nums">{balance(row.financials?.marketCap)}</span>
    ),
  },
  {
    id: 'reportedNetAssets',
    header: 'Reported net assets (INR)',
    value: (row) =>
      row.financials?.reportedNetAssets == null ? null : Number(row.financials.reportedNetAssets),
    align: 'right',
    minWidth: '13rem',
    cell: (row) => (
      <span className="font-mono tabular-nums">{balance(row.financials?.reportedNetAssets)}</span>
    ),
  },
  {
    id: 'statement',
    header: 'Balance sheet',
    value: (row) => row.financials?.statementDate ?? null,
    sortable: false,
    minWidth: '10rem',
    cell: (row) =>
      row.financials?.statementDate ? (
        <div className="text-xs">
          <span>{day(row.financials.statementDate)}</span>
          <div className="mt-1 capitalize text-muted-foreground">
            {row.financials.statementBasis}
          </div>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Unavailable</span>
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
        <ExplorerFilters view={view} />
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

function ExplorerFilters({ view }: { view: View }) {
  return (
    <form
      method="get"
      action="/equities/preview"
      className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
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
        options={[
          { value: 'stocks', label: 'All stocks (incl. BE / SME)' },
          ...view.series.map((value) => ({ value, label: value })),
        ]}
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
        name="ratios"
        label="Net-assets ratio"
        value={view.filters.ratios}
        allValue="all"
        allLabel="All financial states"
        options={[
          { value: 'available', label: 'Ratio available' },
          { value: 'missing', label: 'Ratio unavailable' },
          { value: 'low', label: 'Positive ratio below 1×' },
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
          prices and reported balance-sheet net assets, with unsupported inputs kept visible.
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
            sub: 'All series and instrument types',
          },
          {
            label: 'LISTED EQUITY COVERAGE',
            value: summary.universeAudit
              ? `${number.format(summary.universeAudit.matched)} / ${number.format(summary.universeAudit.listedEquityEntries)}`
              : 'Unaudited',
            sub: 'Official mainboard + SME references',
          },
          {
            label: 'NO DAILY OBSERVATION',
            value: number.format(summary.counts.withoutObservation),
            sub: 'Missing prices stay unavailable',
          },
          {
            label: 'NET-ASSETS RATIOS',
            value: summary.financialCoverage
              ? number.format(summary.financialCoverage.supportedRatios)
              : 'Not prepared',
            sub: summary.financialCoverage
              ? `${number.format(summary.financialCoverage.statementIdentities)} supported filing identities · partial coverage`
              : 'No financial projection loaded',
          },
        ]}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Listed equity coverage includes mainboard and SME entries listed by the price session.
        Ratios use reported assets minus external liabilities and verified issued shares, with
        partial coverage. Consolidated net assets can include noncontrolling interests; this is not
        investment NAV or parent-common P/B.
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
              title="Reported net assets"
              variant="paper"
              rows={[
                {
                  label: 'Market cap / reported net assets',
                  value: ratio(selected.financials?.ratio),
                },
                {
                  label: 'Ratio status',
                  value:
                    selected.financials?.ratio == null
                      ? reason(selected.financials?.reason)
                      : selected.financials.rankingEligible && summary.freshness.status !== 'stale'
                        ? 'Qualified inputs'
                        : 'Historical inputs; excluded from positive screening',
                },
                {
                  label: 'Market cap (INR)',
                  value: selected.financials?.marketCap ?? 'Unavailable',
                },
                {
                  label: 'Verified issued shares',
                  value: selected.financials?.verifiedShares ?? 'Unavailable',
                },
                {
                  label: 'Total assets (INR)',
                  value: selected.financials?.assets ?? 'Unavailable',
                },
                {
                  label: 'External liabilities (INR)',
                  value: selected.financials?.externalLiabilities ?? 'Unavailable',
                },
                {
                  label: 'Reported net assets (INR)',
                  value: selected.financials?.reportedNetAssets ?? 'Unavailable',
                },
                {
                  label: 'Reported total equity (INR)',
                  value: selected.financials?.reportedEquity ?? 'Unavailable',
                },
                {
                  label: 'Parent equity (INR)',
                  value: selected.financials?.parentEquity ?? 'Unavailable',
                },
                {
                  label: 'Noncontrolling interests (INR)',
                  value: selected.financials?.noncontrollingInterests ?? 'Unavailable',
                },
                {
                  label: 'Statement date / basis',
                  value: selected.financials?.statementDate
                    ? `${day(selected.financials.statementDate)} / ${selected.financials.statementBasis}`
                    : 'Unavailable',
                },
                { label: 'Price date', value: day(summary.tradeDate) },
              ]}
              footer={`Assets minus external liabilities, reconciled to reported equity. This is not investment NAV. ${(selected.financials?.warnings ?? []).join(' ')}`}
            />
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
                { label: 'Investment NAV / ownership', value: 'Separately unqualified' },
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
              {selected.financials?.evidence ? (
                <Button asChild variant="outline" className="w-full justify-start">
                  <a href={selected.financials.evidence.url} target="_blank" rel="noreferrer">
                    Original financial filing ↗
                  </a>
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Publicly observed {day(summary.availableAt)}. Local inspection does not grant public
                display or export permission.
              </p>
              <div className="space-y-2 break-all font-mono text-[10px] leading-5 text-muted-foreground">
                <p>Snapshot {summary.snapshotId}</p>
                <p>Retained row {selected.inputSnapshotId}</p>
                <p>Extractor {summary.extractorVersion}</p>
                {selected.financials?.evidence ? (
                  <p>Filing SHA-256 {selected.financials.evidence.sha256}</p>
                ) : null}
                {selected.financials?.availableAt ? (
                  <p>Filing bytes first observed {selected.financials.availableAt}</p>
                ) : null}
                {selected.financials?.asOf ? (
                  <p>Calculation as of {selected.financials.asOf}</p>
                ) : null}
                {selected.financials?.resultId ? (
                  <p>Calculation {selected.financials.resultId}</p>
                ) : null}
                {selected.financials?.inputIds?.map((id) => (
                  <p key={id}>Input {id}</p>
                ))}
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
