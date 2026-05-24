import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const ENTITIES_PATH = resolve(ROOT, "python/ingest/src/high_signal_ingest/seed/ai_infra_entities.csv");
const OUT_PATH = resolve(ROOT, "apps/web/src/data/price-context.json");

type CsvRow = Record<string, string>;

interface PricePoint {
  date: string;
  close: number;
}

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

function pctMove(current: number, prior: number | null) {
  if (prior === null || prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

function pointAtOrBefore(points: PricePoint[], indexFromEnd: number) {
  const index = points.length - 1 - indexFromEnd;
  return index >= 0 ? points[index]?.close ?? null : null;
}

function round(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

async function fetchYahooContext(entity: CsvRow): Promise<PriceContextRow | null> {
  const ticker = entity.ticker;
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d`,
    { headers: { "User-Agent": "HighSignal/1.0 (price context)" } },
  );
  if (!response.ok) throw new Error(`yahoo_${response.status}`);
  const json = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points = timestamps
    .map((timestamp, index) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close: closes[index] }))
    .filter((point): point is PricePoint => typeof point.close === "number" && Number.isFinite(point.close));
  const currentPrice = result?.meta?.regularMarketPrice ?? points.at(-1)?.close;
  const latest = points.at(-1);
  if (!latest || typeof currentPrice !== "number" || !Number.isFinite(currentPrice)) return null;
  return {
    entityId: entity.id,
    ticker,
    name: entity.name,
    source: "yahoo",
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`,
    asOf: latest.date,
    currentPrice: round(currentPrice) ?? currentPrice,
    move1d: round(pctMove(currentPrice, pointAtOrBefore(points, 1))),
    move7d: round(pctMove(currentPrice, pointAtOrBefore(points, 7))),
    move30d: round(pctMove(currentPrice, pointAtOrBefore(points, 30))),
    move45d: round(pctMove(currentPrice, pointAtOrBefore(points, 45))),
    move90d: round(pctMove(currentPrice, pointAtOrBefore(points, 90))),
    historyDays: points.length,
  };
}

async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R | null>) {
  const out: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      const result = await fn(item);
      if (result) out.push(result);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  const raw = await readFile(ENTITIES_PATH, "utf8");
  const entities = parseCsv(raw)
    .filter((entity) => entity.type === "public" && entity.ticker)
    .slice(0, Number(process.env["PRICE_CONTEXT_LIMIT"] ?? 120));
  const rows = await runPool(entities, 8, async (entity) =>
    fetchYahooContext(entity).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`- failed ${entity.ticker}: ${message}`);
      return null;
    }),
  );
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
