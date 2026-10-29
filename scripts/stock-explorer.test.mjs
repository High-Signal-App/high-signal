import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localStockPreviewAllowed } from '../apps/web/src/lib/stock-preview-access.ts';
import { stockExplorerPage, stockPreviewFreshness } from '../apps/web/src/lib/stock-explorer.ts';

test('preview authorization, filtering, sorting and pagination', () => {
  for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
    assert.equal(
      localStockPreviewAllowed('development', host, '/private/input.json', '127.0.0.1'),
      true
    );
    assert.equal(
      localStockPreviewAllowed('production', host, '/private/input.json', '127.0.0.1'),
      false
    );
  }
  for (const host of ['highsignal.app', 'localhost.evil.test', 'evil@localhost', null])
    assert.equal(
      localStockPreviewAllowed('development', host, '/private/input.json', '127.0.0.1'),
      false
    );
  assert.equal(localStockPreviewAllowed('development', 'localhost', undefined, '127.0.0.1'), false);
  assert.equal(localStockPreviewAllowed('development', 'localhost', '/private/input.json'), false);
  assert.equal(
    stockPreviewFreshness('2026-10-28', new Date('2026-10-28T14:00:00Z')).status,
    'fresh'
  );
  assert.equal(
    stockPreviewFreshness('2026-10-28', new Date('2026-10-29T14:00:00Z')).status,
    'stale'
  );
  assert.equal(
    stockPreviewFreshness('2026-10-28', new Date('2026-10-29T12:00:00Z')).status,
    'fresh'
  );
  assert.equal(
    stockPreviewFreshness('2026-10-30', new Date('2026-11-02T12:00:00Z')).status,
    'fresh'
  );

  const base = {
    id: 'zero',
    ticker: 'ZERO.NS',
    symbol: 'ZERO',
    name: 'Zero test',
    series: 'EQ',
    isin: 'INE-TEST-ZERO',
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
    { ...base, id: 'missing', isin: 'INE-MISSING', symbol: 'MISSING', close: null },
    { ...base, id: 'ten', isin: 'INE-TEN', symbol: 'TEN', close: '10' },
    { ...base, id: 'two', isin: 'INE-TWO', symbol: 'TWO', close: '2' },
    { ...base, id: 'deleted', deleted: true },
    { ...base, id: 'test', testInstrument: true },
    { ...base, id: 'invalid', identifierValid: false },
    { ...base, id: 'sme', isin: 'INE-SME', series: 'SM' },
  ];
  const packet = { rows };
  assert.deepEqual(
    stockExplorerPage(packet, { series: 'EQ', prices: 'reported' }).rows.map((row) => row.id),
    ['ten', 'two', 'zero']
  );
  assert.deepEqual(
    stockExplorerPage(packet, { prices: 'missing' }).rows.map((row) => row.id),
    ['missing']
  );
  assert.equal(stockExplorerPage(packet, { q: ['INE-', 'ignored'] }).rowCount, 5);
  assert.equal(
    stockExplorerPage(packet, {}).rowCount,
    5,
    'defaults include SME and missing prices'
  );
  const all = { series: 'all', prices: 'all', listing: 'all' };
  assert.equal(
    stockExplorerPage(packet, all).rowCount,
    rows.length,
    'full master remains discoverable'
  );
  assert.deepEqual(
    stockExplorerPage(packet, { sort: 'close', dir: 'asc', prices: 'all', series: 'EQ' }).rows.map(
      (row) => row.id
    ),
    ['zero', 'two', 'ten', 'missing']
  );
  assert.deepEqual(
    stockExplorerPage(packet, { sort: 'close', dir: 'desc', prices: 'all', series: 'EQ' }).rows.map(
      (row) => row.id
    ),
    ['ten', 'two', 'zero', 'missing']
  );
  const many = {
    rows: Array.from({ length: 121 }, (_, i) => ({
      ...base,
      id: String(i),
      isin: `INE${i}`,
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
});

test('reported net-assets ratios sort numerically and missing values stay last', () => {
  const base = {
    isin: 'INE-TEST',
    id: 'base',
    symbol: 'BASE',
    name: 'Base',
    series: 'EQ',
    deleted: false,
    testInstrument: false,
    identifierValid: true,
    close: '10',
  };
  const financials = (ratio, rankingEligible = true) => ({
    ratio,
    marketCap: '100',
    reportedNetAssets: '50',
    rankingEligible,
    reason: null,
  });
  const rows = [
    { ...base, id: 'ten', financials: financials('10') },
    { ...base, id: 'two', financials: financials('2') },
    { ...base, id: 'half', financials: financials('0.5') },
    { ...base, id: 'negative', financials: financials('-1') },
    { ...base, id: 'zero', financials: financials('0') },
    { ...base, id: 'historical', financials: financials('0.25', false) },
    { ...base, id: 'missing', financials: financials(null) },
    { ...base, id: 'unprepared', financials: null },
    { ...base, id: 'sme', isin: 'INE-SME', series: 'SM', financials: financials('0.75') },
  ];
  const packet = {
    rows: rows.map((row) => ({ ...row, isin: `INE${row.id}` })),
    freshness: { status: 'fresh' },
  };
  assert.deepEqual(
    stockExplorerPage(packet, { sort: 'ratio', dir: 'asc' }).rows.map((r) => r.id),
    ['negative', 'zero', 'historical', 'half', 'sme', 'two', 'ten', 'missing', 'unprepared']
  );
  assert.deepEqual(
    stockExplorerPage(packet, { sort: 'ratio', dir: 'desc' }).rows.map((r) => r.id),
    ['ten', 'two', 'sme', 'half', 'historical', 'zero', 'negative', 'missing', 'unprepared']
  );
  assert.deepEqual(
    stockExplorerPage(packet, { ratios: 'missing' }).rows.map((r) => r.id),
    ['missing', 'unprepared']
  );
  assert.equal(stockExplorerPage(packet, { ratios: 'available' }).rowCount, 7);
  assert.deepEqual(
    stockExplorerPage(packet, { ratios: 'low' }).rows.map((r) => r.id),
    ['half', 'sme']
  );
  assert.equal(
    stockExplorerPage({ ...packet, freshness: { status: 'stale' } }, { ratios: 'low' }).rowCount,
    0
  );
});

test('all stocks shows one listing per ISIN and all retained series preserves source rows', () => {
  const base = {
    id: '1',
    symbol: 'ISSUER',
    name: 'Issuer',
    isin: 'INE123',
    series: 'BE',
    close: '100',
    deleted: false,
    testInstrument: false,
    identifierValid: true,
  };
  const packet = {
    rows: [
      base,
      { ...base, id: '2', series: 'EQ', close: null },
      { ...base, id: '3', series: 'EQ', financials: { ratio: '1.2', rankingEligible: true } },
      { ...base, id: '4', isin: 'INE456', series: 'SM' },
      { ...base, id: '5', isin: 'INE789', series: 'N1' },
      { ...base, id: '6', isin: 'IN9123', series: 'EQ' },
    ],
  };
  assert.deepEqual(
    stockExplorerPage(packet, {}).rows.map((row) => row.id),
    ['3', '4', '6']
  );
  assert.equal(stockExplorerPage(packet, { series: 'all' }).rowCount, 6);
  assert.equal(stockExplorerPage(packet, { series: 'EQ' }).rowCount, 3);
  assert.equal(stockExplorerPage(packet, { prices: 'missing' }).rowCount, 0);
  assert.deepEqual(
    stockExplorerPage(packet, { ratios: 'missing' }).rows.map((row) => row.id),
    ['4', '6'],
    'an alternate unquoted series cannot make a supported stock appear unavailable'
  );
});

test('render-time staleness overrides a previously eligible table row', () => {
  const row = {
    id: '1',
    symbol: 'TEST',
    isin: 'INE123',
    series: 'EQ',
    close: '1',
    identifierValid: true,
    financials: { ratio: '0.5', rankingEligible: true },
  };
  const view = stockExplorerPage({ rows: [row], freshness: { status: 'stale' } }, {});
  assert.equal(view.rows[0].financials.rankingEligible, false);
  assert.equal(row.financials.rankingEligible, true);
});
