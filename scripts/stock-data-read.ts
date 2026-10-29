import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readStockPriceDataset } from '../packages/shared/src/stock-data';

export async function loadStockPrices() {
  const path =
    process.env['STOCK_PRICE_INPUT'] ?? resolve(__dirname, '../data/stock-data-prices.json');
  return readStockPriceDataset(JSON.parse(await readFile(path, 'utf8')));
}

export async function publishStockPriceStatus(
  dataset: Awaited<ReturnType<typeof loadStockPrices>>
) {
  const permitted = dataset.rights.publicDisplay === 'permitted';
  const path =
    process.env['STOCK_PRICE_STATUS_OUTPUT'] ??
    resolve(__dirname, '../packages/shared/src/stock-data/price-status.json');
  await writeFile(
    path,
    `${JSON.stringify(
      {
        snapshotId: dataset.snapshotId,
        generatedAt: dataset.generatedAt,
        publicDisplay: dataset.rights.publicDisplay,
        reason: permitted ? null : 'Price display withheld: usage rights unresolved or prohibited.',
      },
      null,
      2
    )}\n`
  );
  if (!permitted)
    console.log(
      'Price display withheld; retaining previous numerical bundles as historical inputs.'
    );
  return permitted;
}
