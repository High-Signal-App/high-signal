import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MarketRefreshRecord } from "@high-signal/shared";

const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "data/personal-market-refresh.jsonl");
const OUT_PATH = resolve(ROOT, "apps/web/src/data/market-refreshes.json");

function parseRecords(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MarketRefreshRecord)
    .filter((record) => record.source === "yahoo" && record.createdAt && Array.isArray(record.groups));
}

async function main() {
  const raw = await readFile(SOURCE_PATH, "utf8").catch(() => "");
  const records = parseRecords(raw)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 90)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(records, null, 2)}\n`);
  const { size } = await stat(OUT_PATH);
  console.log(
    JSON.stringify({
      source: SOURCE_PATH,
      out: OUT_PATH,
      records: records.length,
      bytes: size,
      latest: records.at(-1)?.createdAt ?? null,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
