// Transforms data/equities-snapshot.jsonl (produced by the Python equities_daily
// pipeline) into a compact JSON bundle that the Next.js /equities page imports
// at build time.
//
// Drops obviously empty rows (no last_close) so the UI doesn't have to filter,
// and trims Tier 2/3 columns that are entirely null in the input (Phase 1 only
// populates Tier 1 — keeping the JSON small is worth the trim).

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "data/equities-snapshot.jsonl");
const OUT_PATH = resolve(ROOT, "apps/web/src/data/equities-snapshot.json");

interface EquityRow {
  ticker: string;
  symbol?: string;
  exchange?: string;
  name?: string | null;
  asset_class?: string;
  currency?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;

  last_close?: number | null;
  last_date?: number | null;
  ret_1d?: number | null;
  ret_30d?: number | null;
  ret_90d?: number | null;
  ret_1y?: number | null;
  ret_5y?: number | null;
  ret_1d_usd?: number | null;
  ret_30d_usd?: number | null;
  ret_90d_usd?: number | null;
  ret_1y_usd?: number | null;
  ret_5y_usd?: number | null;
  volume_avg_30d?: number | null;
  volatility_30d?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  dist_to_52w_high?: number | null;
  dist_to_52w_low?: number | null;
  max_drawdown_1y?: number | null;
  max_drawdown_5y?: number | null;
  sma_50?: number | null;
  sma_200?: number | null;
  golden_cross?: boolean;
  death_cross?: boolean;
  beta_vs_spy?: number | null;
  rel_strength_spy_90d?: number | null;

  // Tier 2/3 left for completeness; transformer ignores them while null.
  market_cap?: number | null;
  dividend_yield?: number | null;
}

function parseJsonl(raw: string): EquityRow[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as EquityRow;
      } catch {
        return null;
      }
    })
    .filter((row): row is EquityRow => Boolean(row) && Boolean(row.ticker));
}

async function main() {
  let raw = "";
  try {
    raw = await readFile(SOURCE_PATH, "utf8");
  } catch (error) {
    console.log(`- no source JSONL at ${SOURCE_PATH}; writing empty bundle`);
  }

  const allRows = parseJsonl(raw);
  const withData = allRows.filter((row) => row.last_close != null);

  const payload = {
    source: "equities-daily",
    generatedAt: new Date().toISOString(),
    universeSize: allRows.length,
    rowsWithData: withData.length,
    rows: withData.sort((a, b) => (b.ret_30d ?? -Infinity) - (a.ret_30d ?? -Infinity)),
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const { size } = await stat(OUT_PATH);
  console.log(
    JSON.stringify({
      out: OUT_PATH,
      universe: allRows.length,
      withData: withData.length,
      bytes: size,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
