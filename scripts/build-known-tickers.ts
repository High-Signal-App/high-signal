// Derives a slim known-ticker allowlist for the Worker from the equities
// snapshot. /unmapped uses this to surface bare TICKER mentions (no `$`
// prefix) — only tokens that match a real instrument in the universe get
// promoted to candidates, which is the cheapest way to keep false
// positives down without a full NER pass.
//
// The shape is intentionally minimal — just an array of symbols — so the
// JSON stays well under 50KB and TypeScript can `import` it directly.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SOURCE_PATH = resolve(ROOT, 'apps/web/src/data/equities-snapshot.json');
const OUT_PATH = resolve(ROOT, 'workers/api/src/lib/known-tickers.json');

interface SnapshotRow {
  ticker?: string;
  symbol?: string;
}

interface Snapshot {
  rows: SnapshotRow[];
}

async function main() {
  const raw = await readFile(SOURCE_PATH, 'utf8');
  const snap = JSON.parse(raw) as Snapshot;

  // Symbol is the bare equity ticker without yfinance suffixes ("BRK"
  // not "BRK-B", "NVDA" not "NVDA"). Fall back to `ticker` if `symbol`
  // is missing (older rows). Then keep only pure-alpha 2-5 char codes —
  // anything with digits/dashes is either crypto or international and
  // won't appear as a bare token in English-language event text.
  const symbols = new Set<string>();
  for (const row of snap.rows ?? []) {
    const sym = (row.symbol ?? row.ticker ?? '').toUpperCase().trim();
    if (/^[A-Z]{2,5}$/.test(sym)) symbols.add(sym);
  }

  const sorted = Array.from(symbols).sort();
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(sorted, null, 0)}\n`);
  const { size } = await stat(OUT_PATH);
  console.log(JSON.stringify({ out: OUT_PATH, symbols: sorted.length, bytes: size }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
