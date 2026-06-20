#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { buildDailyRangeSummary, resolveDailyRangeDates } from "../apps/web/src/lib/daily-range";
import { acceptedRefreshDates, readSourceRefreshes } from "../apps/web/src/lib/daily-intelligence";
import productGraph from "../data/personal-product-graph.json";
import type { PersonalProductProfile } from "@high-signal/shared";

const resolved = resolveDailyRangeDates({
  availableDates: ["2026-05-20", "2026-05-21", "2026-05-22"],
  days: 2,
  to: "2026-05-22",
});
assert.deepEqual(resolved.dates, ["2026-05-22", "2026-05-21"]);
assert.equal(resolved.from, "2026-05-21");
assert.equal(resolved.to, "2026-05-22");

const swapped = resolveDailyRangeDates({
  availableDates: ["2026-05-20", "2026-05-21", "2026-05-22"],
  from: "2026-05-22",
  to: "2026-05-20",
});
assert.deepEqual(swapped.dates, ["2026-05-22", "2026-05-21", "2026-05-20"]);
assert.equal(swapped.from, "2026-05-20");
assert.equal(swapped.to, "2026-05-22");

async function main() {
const records = await readSourceRefreshes();
const dates = acceptedRefreshDates(records);
  assert.ok(dates.length >= 1, "expected at least one accepted refresh date");

  const products = productGraph.products as PersonalProductProfile[];
  const daysRequested = Math.min(30, dates.length);
  const summary = await buildDailyRangeSummary({
    records,
    products,
    filters: {
      layer: "app-complaint",
      domain: "regional",
      requirement: true,
    },
    to: dates[0],
    days: daysRequested,
    includeTasks: true,
  });

  assert.ok(
    summary.daysReturned >= 1 && summary.daysReturned <= daysRequested,
    `expected 1..${daysRequested} daysReturned, got ${summary.daysReturned}`,
  );
  assert.ok(summary.totals.broadInsights >= summary.totals.requirements);
  assert.equal(summary.totals.taskExports, summary.days.reduce((sum, day) => sum + day.taskExportCount, 0));
  assert.equal(summary.totals.productRequirements, summary.days.reduce((sum, day) => sum + day.productRequirementCount, 0));
  assert.ok(summary.days.every((day) => day.qualityGateCounts.every((item) => item.n > 0)));
  assert.ok(summary.days.some((day) => day.taskExports.length === day.taskExportCount));

  console.log("daily-range.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
