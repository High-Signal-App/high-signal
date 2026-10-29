import assert from 'node:assert/strict';
import { localStockPreviewAllowed } from '../apps/web/src/lib/stock-preview-access.ts';
import { stockExplorerPage } from '../apps/web/src/lib/stock-explorer.ts';

for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
  assert.equal(localStockPreviewAllowed('development', host, '/private/input.json'), true);
  assert.equal(localStockPreviewAllowed('production', host, '/private/input.json'), false);
}
for (const host of ['highsignal.app', 'localhost.evil.test', 'evil@localhost', null])
  assert.equal(localStockPreviewAllowed('development', host, '/private/input.json'), false);
assert.equal(localStockPreviewAllowed('development', 'localhost', undefined), false);

const base = {
  id: 'zero',
  ticker: 'ZERO.NS',
  symbol: 'ZERO',
  name: 'Zero test',
  series: 'EQ',
  isin: 'IN-TEST-ZERO',
  instrumentId: '1',
  deleted: false,
  testInstrument: false,
  identifierValid: true,
  close: '0.00',
  open: null,
  high: null,
  low: null,
  previousClose: null,
  volume: '0',
  turnover: null,
  trades: null,
  inputSnapshotId: 'row:zero',
};
const rows = [
  base,
  { ...base, id: 'missing', symbol: 'MISSING', close: null },
  { ...base, id: 'ten', symbol: 'TEN', close: '10' },
  { ...base, id: 'two', symbol: 'TWO', close: '2' },
  { ...base, id: 'deleted', deleted: true },
  { ...base, id: 'test', testInstrument: true },
  { ...base, id: 'invalid', identifierValid: false },
  { ...base, id: 'sme', series: 'SM' },
];
const packet = { rows };
assert.deepEqual(
  stockExplorerPage(packet, {}).rows.map((row) => row.id),
  ['ten', 'two', 'zero']
);
assert.deepEqual(
  stockExplorerPage(packet, { prices: 'missing' }).rows.map((row) => row.id),
  ['missing']
);
assert.equal(stockExplorerPage(packet, { q: ['IN-TEST-ZERO', 'ignored'] }).rowCount, 3);
const all = { series: 'all', prices: 'all', listing: 'all' };
assert.equal(
  stockExplorerPage(packet, all).rowCount,
  rows.length,
  'full master remains discoverable'
);
assert.deepEqual(
  stockExplorerPage(packet, { sort: 'close', dir: 'asc', prices: 'all' }).rows.map((row) => row.id),
  ['zero', 'two', 'ten', 'missing']
);
assert.deepEqual(
  stockExplorerPage(packet, { sort: 'close', dir: 'desc', prices: 'all' }).rows.map(
    (row) => row.id
  ),
  ['ten', 'two', 'zero', 'missing']
);
const many = {
  rows: Array.from({ length: 121 }, (_, i) => ({
    ...base,
    id: String(i),
    symbol: String(i).padStart(3, '0'),
  })),
};
assert.equal(stockExplorerPage(many, { page: '99999999' }).page, 2);
assert.equal(stockExplorerPage(many, { page: '1' }).rows.length, 50);
assert.equal(stockExplorerPage(many, { page: '-1' }).page, 0);
assert.equal(stockExplorerPage(many, { page: 'NaN' }).page, 0);
assert.equal(stockExplorerPage(packet, { q: 'not-a-company' }).rowCount, 0);
assert.equal(packet.rows.length, rows.length, 'view sorting never mutates retained inputs');
console.log('stock-explorer.test.mjs: ok');
