import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fetchCurrentStockData, type StockDataset } from '../packages/shared/src/stock-data/public';
import { loadEquitiesBundle } from '../apps/web/src/lib/equities';
import { pricedInContext } from '../apps/web/src/lib/price-context';

async function main() {
  assert.equal(
    await fetchCurrentStockData(async () =>
      Response.json({ error: 'stock_data_rights_changed' }, { status: 503 })
    ),
    null
  );
  assert.equal(
    await fetchCurrentStockData(async () => {
      throw new Error('offline');
    }),
    null
  );
  const current = {
    as_of: new Date().toISOString(),
    facts: [],
    valuations: [],
    snapshot_id: 'current',
  } as unknown as StockDataset;
  assert.equal(
    (await fetchCurrentStockData(async () => Response.json(current)))?.snapshot_id,
    'current'
  );
  assert.equal(loadEquitiesBundle().rows.length, 0);
  assert.equal(pricedInContext('NVDA', 'up').price, null);

  const directory = await mkdtemp(join(tmpdir(), 'high-signal-stock-consumers-'));
  const input = join(directory, 'prices.json');
  const status = join(directory, 'status.json');
  const tickers = join(directory, 'tickers.json');
  await writeFile(
    input,
    JSON.stringify({
      contractVersion: 'stock-data.prices.v1',
      snapshotId: 'prices:test',
      generatedAt: new Date().toISOString(),
      completeness: 'partial',
      historyAvailable: true,
      coverage: {},
      rights: {
        publicDisplay: 'unknown',
        export: 'unknown',
        policyUrl: 'https://example.org/terms',
      },
      rows: [
        {
          ticker: 'NVDA.US',
          symbol: 'NVDA',
          entityId: 'NVDA',
          securityId: 'security:NVDA.US',
          inputSnapshotId: 'row:test',
          inputSnapshotIds: ['snapshot:test'],
          sourceRefs: [{ sourceId: 'test', url: 'https://example.org' }],
          priceBasis: 'total_return_adjusted',
          last_close: 10,
        },
      ],
    })
  );
  const paths = [
    'apps/web/src/data/equities-snapshot.json',
    'apps/web/src/data/price-context.json',
    'data/personal-market-refresh.jsonl',
  ];
  const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  for (const script of [
    'build-equities-snapshot',
    'build-price-context',
    'refresh-market-context',
    'build-known-tickers',
  ]) {
    const result = spawnSync(resolve('node_modules/.bin/tsx'), [`scripts/${script}.ts`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        STOCK_PRICE_INPUT: input,
        STOCK_PRICE_STATUS_OUTPUT: status,
        KNOWN_TICKERS_OUTPUT: tickers,
      },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(path, 'utf8'))),
    before,
    'unresolved rights must not erase last valid bundles'
  );
  assert.equal(JSON.parse(await readFile(status, 'utf8')).publicDisplay, 'unknown');
  assert.deepEqual(
    JSON.parse(await readFile(tickers, 'utf8')),
    ['NVDA'],
    'internal identity matching is independent of display rights'
  );
  await writeFile(tickers, JSON.stringify(['AMD', 'BAD', 'INFY', 'NVDA']));
  const limitedManifest = JSON.parse(await readFile(input, 'utf8'));
  limitedManifest.universeComplete = false;
  limitedManifest.rows.push({
    ...limitedManifest.rows[0],
    ticker: 'TCS.NS',
    symbol: 'TCS',
    securityId: 'security:nse:TCS',
    exchange: 'NSE',
    series: 'EQ',
    priceBasis: 'unadjusted',
  });
  limitedManifest.rows.push({
    ...limitedManifest.rows[0],
    ticker: 'BAD.NS',
    symbol: 'BAD',
    deleted: true,
  });
  limitedManifest.rows.push({
    ...limitedManifest.rows[0],
    ticker: 'BOND.N0.NS',
    symbol: 'BOND',
    exchange: 'NSE',
    series: 'N0',
  });
  await writeFile(input, JSON.stringify(limitedManifest));
  const limited = spawnSync(resolve('node_modules/.bin/tsx'), ['scripts/build-known-tickers.ts'], {
    encoding: 'utf8',
    env: { ...process.env, STOCK_PRICE_INPUT: input, KNOWN_TICKERS_OUTPUT: tickers },
  });
  assert.equal(limited.status, 0, limited.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(tickers, 'utf8')),
    ['AMD', 'BAD', 'INFY', 'NVDA', 'TCS'],
    'partial global inputs must preserve NSE identities and consume retained raw-close rows'
  );
  const missingStatus = join(directory, 'missing-status.json');
  for (const script of [
    'build-equities-snapshot',
    'build-price-context',
    'refresh-market-context',
    'build-known-tickers',
  ]) {
    const result = spawnSync(resolve('node_modules/.bin/tsx'), [`scripts/${script}.ts`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        STOCK_PRICE_INPUT: join(directory, 'missing.json'),
        STOCK_PRICE_STATUS_OUTPUT: missingStatus,
        KNOWN_TICKERS_OUTPUT: tickers,
      },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before);
  assert.deepEqual(JSON.parse(await readFile(tickers, 'utf8')), [
    'AMD',
    'BAD',
    'INFY',
    'NVDA',
    'TCS',
  ]);
  assert.equal(JSON.parse(await readFile(missingStatus, 'utf8')).publicDisplay, 'unknown');
  console.log('stock-data-consumers.test.ts: ok');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
