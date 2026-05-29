// price-context.json — derived from data/equities-snapshot.jsonl.
//
// Single source of truth for equity price data in high-signal: the Python
// equities_daily pipeline (yfinance) writes the JSONL, and this script picks
// the ai_infra_entities subset out of it and reshapes for the SignalCard /
// signal-detail "priced in?" check (lib/price-context.ts).
//
// Was a direct Yahoo HTTP fetcher before — replaced 2026-05 so there's one
// place equity data enters the system, not two.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const ENTITIES_PATH = resolve(
  ROOT,
  "python/ingest/src/high_signal_ingest/seed/ai_infra_entities.csv",
);
const SNAPSHOT_PATH = resolve(ROOT, "data/equities-snapshot.jsonl");
const OUT_PATH = resolve(ROOT, "apps/web/src/data/price-context.json");

type CsvRow = Record<string, string>;

interface PriceContextRow {
  entityId: string;
  ticker: string;
  name: string;
  source: "yahoo";
  sourceUrl: string;
  asOf: string;
  currentPrice: number;
  move1d: number | null;
  move7d: number | null;
  move30d: number | null;
  move45d: number | null;
  move90d: number | null;
  historyDays: number;
}

interface SnapshotRow {
  ticker: string;
  name?: string | null;
  last_close?: number | null;
  last_date?: number | null;
  ret_1d?: number | null;
  ret_30d?: number | null;
  ret_90d?: number | null;
  ret_1y?: number | null;
  ret_5y?: number | null;
}

function parseCsv(raw: string): CsvRow[] {
  const [headerLine = "", ...lines] = raw.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return lines
    .map(parseCsvLine)
    .filter((cols) => cols.length > 1)
    .map((cols) => Object.fromEntries(headers.map((header, index) => [header, cols[index] ?? ""])));
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((value) => value.trim());
}

function parseJsonl(raw: string): SnapshotRow[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SnapshotRow;
      } catch {
        return null;
      }
    })
    .filter((row): row is SnapshotRow => Boolean(row) && Boolean(row.ticker));
}

function round(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function toPctRounded(decimal: number | null | undefined): number | null {
  // Snapshot returns are decimals (0.05 = 5%); price-context schema expects
  // percent units (5 = 5%) per the existing consumer thresholds.
  if (decimal == null || !Number.isFinite(decimal)) return null;
  return round(decimal * 100);
}

function yyyymmddToIso(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "";
  const y = Math.floor(value / 10000);
  const m = Math.floor((value % 10000) / 100);
  const d = value % 100;
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

function estimateHistoryDays(snap: SnapshotRow): number {
  // Best-effort: which return windows survived sentinels the snapshot's compute path.
  if (snap.ret_5y != null) return 1260;
  if (snap.ret_1y != null) return 252;
  if (snap.ret_90d != null) return 63;
  if (snap.ret_30d != null) return 22;
  return 0;
}

function buildSnapshotLookup(rows: SnapshotRow[]): Map<string, SnapshotRow> {
  const map = new Map<string, SnapshotRow>();
  for (const row of rows) {
    if (row.last_close == null) continue;
    // Primary canonical key
    map.set(row.ticker, row);
    // Also map without the ".US" suffix so ai_infra_entities CSVs with
    // bare US tickers (AAPL, NVDA, …) match against AAPL.US in the snapshot.
    if (row.ticker.endsWith(".US")) {
      map.set(row.ticker.slice(0, -3), row);
    }
  }
  return map;
}

function buildPriceRow(entity: CsvRow, snap: SnapshotRow): PriceContextRow | null {
  const currentPrice = round(snap.last_close ?? null);
  if (currentPrice === null) return null;
  return {
    entityId: entity.id,
    ticker: entity.ticker,
    name: entity.name,
    source: "yahoo",
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(entity.ticker)}`,
    asOf: yyyymmddToIso(snap.last_date),
    currentPrice,
    move1d: toPctRounded(snap.ret_1d),
    // 7d / 45d not produced by the snapshot — consumer logic falls back to
    // [30d, 90d] for the priced-in check; leaving null is the right shape.
    move7d: null,
    move30d: toPctRounded(snap.ret_30d),
    move45d: null,
    move90d: toPctRounded(snap.ret_90d),
    historyDays: estimateHistoryDays(snap),
  };
}

async function main() {
  const entitiesRaw = await readFile(ENTITIES_PATH, "utf8");
  const entities = parseCsv(entitiesRaw)
    .filter((entity) => entity.type === "public" && entity.ticker)
    .slice(0, Number(process.env["PRICE_CONTEXT_LIMIT"] ?? 120));

  let snapshotRaw = "";
  try {
    snapshotRaw = await readFile(SNAPSHOT_PATH, "utf8");
  } catch {
    console.log(`- no snapshot at ${SNAPSHOT_PATH}; writing empty price-context`);
  }
  const lookup = buildSnapshotLookup(parseJsonl(snapshotRaw));

  const rows: PriceContextRow[] = [];
  const misses: string[] = [];
  for (const entity of entities) {
    const snap = lookup.get(entity.ticker) ?? lookup.get(`${entity.ticker}.US`);
    if (!snap) {
      misses.push(entity.ticker);
      continue;
    }
    const row = buildPriceRow(entity, snap);
    if (row) rows.push(row);
  }
  if (misses.length) {
    console.log(`- no snapshot rows for ${misses.length} entities: ${misses.slice(0, 8).join(", ")}${misses.length > 8 ? "…" : ""}`);
  }

  const payload = {
    source: "yahoo",
    generatedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => a.entityId.localeCompare(b.entityId)),
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const { size } = await stat(OUT_PATH);
  console.log(JSON.stringify({ out: OUT_PATH, rows: rows.length, bytes: size }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
