import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { localStockPreviewAllowed } from '@/lib/stock-preview-access';
import {
  stockExplorerPage,
  stockPreviewFreshness,
  type StockExplorerPacket,
  type StockExplorerQuery,
} from '@/lib/stock-explorer';
import { StockMarketExplorer } from '@/components/organisms/StockMarketExplorer';
import { StockDataCoverage } from '@/components/organisms/StockDataCoverage';
import { PageShell, BackLink } from '@/components/system/HighSignalUI';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Local NSE data preview',
  robots: { index: false, follow: false },
};

export default async function StockPreview({
  searchParams,
}: {
  searchParams: Promise<StockExplorerQuery>;
}) {
  const input = process.env['NSE_DASHBOARD_PREVIEW_FILE'];
  if (
    !input ||
    !localStockPreviewAllowed(
      process.env['NODE_ENV'],
      (await headers()).get('host'),
      input,
      process.env['NSE_DASHBOARD_PREVIEW_BINDING']
    )
  )
    notFound();
  // Filesystem access is unreachable in production and never accepts a URL/path query parameter.
  const { readFile } = await import('node:fs/promises');
  const packet = JSON.parse(await readFile(input, 'utf8')) as StockExplorerPacket;
  if (
    packet.contractVersion !== 'stock-data.dashboard-preview.v1' ||
    !Array.isArray(packet.rows) ||
    packet.counts.securities !== packet.rows.length
  )
    throw new Error('Invalid local stock-data preview');
  packet.freshness = stockPreviewFreshness(packet.tradeDate);
  const view = stockExplorerPage(packet, await searchParams);
  const { rows: _rows, ...summary } = packet;
  return (
    <PageShell>
      <BackLink href="/equities">back to equities</BackLink>
      <StockMarketExplorer
        key={JSON.stringify([summary.snapshotId, view.filters, view.sort, view.page])}
        summary={summary}
        view={view}
      />
      <StockDataCoverage />
    </PageShell>
  );
}
