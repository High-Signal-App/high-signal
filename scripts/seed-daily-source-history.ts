#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { addDays } from "@high-signal/shared";

type SourceType = "reddit" | "hacker-news" | "github-issues" | "rss";

type ProductFlowRefreshRecord = {
  source: SourceType;
  sourceId?: string;
  label?: string;
  target?: string;
  period: "day" | "week" | "month";
  prompt?: string;
  digest: {
    id: string;
    subreddit?: string;
    period: "day" | "week" | "month";
    snapshotDate: string;
    summaryText: string;
    summary?: {
      keyTrend?: { title?: string; desc?: string; link?: string };
      notableDiscussions?: Array<{ title?: string; desc?: string; link?: string }>;
      keyAction?: { title?: string; desc?: string; link?: string };
    };
    promptUsed?: string;
    sourceCount: number;
    createdAt?: string;
  };
  createdAt: string;
  refreshStatus?: "accepted" | "rejected";
  refreshReason?: string;
  refreshError?: string;
  historyKind?: "seeded-replay";
};

const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(ROOT, "data/product-flow-refresh.jsonl");
const DEFAULT_DAYS = 30;

function isDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function datePart(record: ProductFlowRefreshRecord) {
  return record.digest.snapshotDate.slice(0, 10);
}

function keyFor(record: Pick<ProductFlowRefreshRecord, "sourceId" | "label" | "target" | "source" | "period">) {
  return `${record.sourceId ?? record.label ?? record.target ?? record.source}:${record.period}`.toLowerCase();
}

function dayKey(record: ProductFlowRefreshRecord) {
  return `${datePart(record)}:${keyFor(record)}`;
}

function isoFor(date: string, index: number) {
  const hour = 7 + (index % 10);
  const minute = (index * 7) % 60;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function parseArgs() {
  const daysArg = process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1];
  const toArg = process.argv.find((arg) => arg.startsWith("--to="))?.split("=")[1];
  const days = Math.max(1, Math.min(31, Number(daysArg) || DEFAULT_DAYS));
  return {
    days,
    to: isDate(toArg) ? toArg! : null,
  };
}

function parseRecords(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProductFlowRefreshRecord)
    .filter((record) => record.digest?.snapshotDate);
}

function isAccepted(record: ProductFlowRefreshRecord) {
  return record.refreshStatus !== "rejected" && record.digest.sourceCount >= 2;
}

function latestAcceptedTemplates(records: ProductFlowRefreshRecord[]) {
  const latest = new Map<string, ProductFlowRefreshRecord>();
  for (const record of records.filter((item) => isAccepted(item) && item.historyKind !== "seeded-replay")) {
    const key = keyFor(record);
    const previous = latest.get(key);
    if (!previous || record.digest.snapshotDate > previous.digest.snapshotDate) {
      latest.set(key, record);
    }
  }
  return Array.from(latest.values())
    .filter((record) => record.sourceId || record.label || record.target)
    .sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
}

function seedRecord(template: ProductFlowRefreshRecord, date: string, index: number): ProductFlowRefreshRecord {
  const snapshotDate = isoFor(date, index);
  const sourceKey = keyFor(template).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const label = template.label ?? template.sourceId ?? template.target ?? template.source;
  const originalTrend = template.digest.summary?.keyTrend;
  const originalTitle = originalTrend?.title ?? `${label}: source-read replay`;
  const originalDesc = originalTrend?.desc ?? template.digest.summaryText;
  const link = originalTrend?.link;
  const notableDiscussions = (template.digest.summary?.notableDiscussions ?? []).slice(0, 3).map((item) => ({
    title: item.title,
    desc: item.desc,
    link: item.link,
  }));
  return {
    ...template,
    digest: {
      ...template.digest,
      id: `seed-history-${sourceKey}-${date}`,
      snapshotDate,
      summaryText: `Seeded historical read for ${label}: ${originalDesc}`,
      summary: {
        keyTrend: {
          title: `${originalTitle} (seeded history)`,
          desc: `Seeded historical read for date-range exploration; replayed from the latest accepted ${label} source snapshot. ${originalDesc}`,
          link,
        },
        notableDiscussions,
        keyAction: {
          title: template.digest.summary?.keyAction?.title ?? "Seeded history implication",
          desc:
            template.digest.summary?.keyAction?.desc ??
            "Use this replayed source read only to inspect historical workflows until live daily snapshots accumulate.",
          link: template.digest.summary?.keyAction?.link ?? link,
        },
      },
      createdAt: snapshotDate,
    },
    createdAt: snapshotDate,
    refreshStatus: "accepted",
    refreshReason: undefined,
    refreshError: undefined,
    historyKind: "seeded-replay",
  };
}

async function main() {
  const args = parseArgs();
  const raw = await readFile(SOURCE_PATH, "utf8").catch(() => "");
  const parsed = parseRecords(raw);
  const liveRecords = parsed.filter((record) => record.historyKind !== "seeded-replay");
  const templates = latestAcceptedTemplates(parsed);
  const latestDate =
    args.to ??
    parsed
      .map(datePart)
      .sort()
      .at(-1) ??
    new Date().toISOString().slice(0, 10);
  const existing = new Set(liveRecords.map(dayKey));
  const seeded: ProductFlowRefreshRecord[] = [];
  for (let offset = 0; offset < args.days; offset += 1) {
    const date = addDays(latestDate, -offset);
    templates.forEach((template, index) => {
      const key = `${date}:${keyFor(template)}`;
      if (!existing.has(key)) {
        seeded.push(seedRecord(template, date, index));
        existing.add(key);
      }
    });
  }
  const out = [...liveRecords, ...seeded].sort((a, b) => a.digest.snapshotDate.localeCompare(b.digest.snapshotDate));
  await writeFile(SOURCE_PATH, `${out.map((record) => JSON.stringify(record)).join("\n")}\n`);
  console.log(
    JSON.stringify({
      source: SOURCE_PATH,
      liveRecords: liveRecords.length,
      templateCount: templates.length,
      seededRecords: seeded.length,
      totalRecords: out.length,
      from: addDays(latestDate, 1 - args.days),
      to: latestDate,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
