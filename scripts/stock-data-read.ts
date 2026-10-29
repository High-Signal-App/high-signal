import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readStockPriceDataset } from '../packages/shared/src/stock-data';

export async function loadStockPrices() {
  const path = resolve(__dirname, '../data/stock-data-prices.json');
  return readStockPriceDataset(JSON.parse(await readFile(path, 'utf8')));
}
