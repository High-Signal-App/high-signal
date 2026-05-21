import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type ProductFlowRefreshRecord = {
  source: "reddit" | "hacker-news" | "github-issues" | "rss";
  sourceId?: string;
  label?: string;
  target?: string;
  period: "day" | "week" | "month";
  digest: {
    snapshotDate: string;
    sourceCount: number;
  };
};

const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "data/product-flow-refresh.jsonl");
const OUT_PATH = resolve(ROOT, "apps/web/src/data/daily-source-refreshes.json");

function keyFor(record: ProductFlowRefreshRecord) {
  return `${record.sourceId ?? record.label ?? record.target ?? record.source}:${record.period}`.toLowerCase();
}

function parseRecords(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProductFlowRefreshRecord)
    .filter((record) => record.digest?.snapshotDate);
}

async function main() {
  const raw = await readFile(SOURCE_PATH, "utf8").catch(() => "");
  const latest = new Map<string, ProductFlowRefreshRecord>();
  for (const record of parseRecords(raw)) {
    const key = keyFor(record);
    const previous = latest.get(key);
    if (!previous || record.digest.snapshotDate > previous.digest.snapshotDate) {
      latest.set(key, record);
    }
  }
  const out = Array.from(latest.values()).sort((a, b) =>
    a.digest.snapshotDate.localeCompare(b.digest.snapshotDate),
  );
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  const { size } = await stat(OUT_PATH);
  console.log(
    JSON.stringify({
      source: SOURCE_PATH,
      out: OUT_PATH,
      records: out.length,
      bytes: size,
      latest: out.map((record) => record.digest.snapshotDate).sort().at(-1) ?? null,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
