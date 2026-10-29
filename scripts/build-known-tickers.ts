// Derives a slim known-ticker allowlist for the Worker from the equities
// private canonical universe. /unmapped uses this to surface bare TICKER mentions (no `$`
// prefix) — only tokens that match a real instrument in the universe get
// promoted to candidates, which is the cheapest way to keep false
// positives down without a full NER pass.
//
// The shape is intentionally minimal — just an array of symbols — so the
// JSON stays well under 50KB and TypeScript can `import` it directly.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
import { loadStockPrices } from './stock-data-read';
import type { StockPriceRow } from '../packages/shared/src/stock-data';
const OUT_PATH =
  process.env['KNOWN_TICKERS_OUTPUT'] ?? resolve(ROOT, 'workers/api/src/lib/known-tickers.json');

async function main() {
  const snap = await loadStockPrices();
  if (!snap.rows.length && snap.completeness === 'unavailable') {
    console.log('Canonical universe unavailable; retaining the last known ticker allowlist.');
    return;
  }

  // Symbol is the bare equity ticker without yfinance suffixes ("BRK"
  // not "BRK-B", "NVDA" not "NVDA"). Fall back to `ticker` if `symbol`
  // is missing (older rows). Then keep only pure-alpha 2-5 char codes —
  // anything with digits/dashes is either crypto or international and
  // won't appear as a bare token in English-language event text.
  let previous: string[] = [];
  if (snap.universeComplete !== true) {
    try {
      previous = JSON.parse(await readFile(OUT_PATH, 'utf8')) as string[];
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
  }
  const sorted = matchingSymbols(snap.rows, previous);
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(sorted, null, 0)}\n`);
  const { size } = await stat(OUT_PATH);
  console.log(JSON.stringify({ out: OUT_PATH, symbols: sorted.length, bytes: size }));
}

function isInactive(row: StockPriceRow) {
  return row.deleted || row.testInstrument || row.identifierValid === false;
}

function matchingSymbols(rows: StockPriceRow[], previous: string[]) {
  const symbols = new Set<string>(previous);
  for (const row of rows) {
    const sym = (row.symbol ?? row.ticker ?? '').toUpperCase().trim();
    if (!/^[A-Z]{2,5}$/.test(sym)) continue;
    if (isInactive(row)) {
      continue;
    }
    // Full NSE data stays in the shared dataset. Bare English-token promotion
    // uses ordinary equity series only; other series need explicit context.
    if (row.exchange === 'NSE' && row['series'] !== 'EQ') continue;
    symbols.add(sym);
  }

  // The legacy list has no provider provenance. An inactive NSE row cannot
  // invalidate an existing symbol from another market or a historical alias.
  return Array.from(symbols).sort();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
