#!/usr/bin/env tsx
import assert from "node:assert/strict";
import bundledRefreshes from "../apps/web/src/data/daily-source-refreshes.json";
import { buildDailyAutomationStatus, type ProductFlowRefreshRecord } from "../apps/web/src/lib/daily-intelligence";

const status = buildDailyAutomationStatus(
  bundledRefreshes as ProductFlowRefreshRecord[],
  new Date("2026-05-22T20:00:00.000Z"),
);

assert.equal(status.workflow, "personal-brief");
assert.equal(status.schedule, "daily 07:30 UTC");
assert.equal(status.freshnessStatus, "fresh");
assert.equal(status.latestAcceptedDate, "2026-05-22");
assert.ok(status.configuredSources >= 69);
assert.ok(status.acceptedSnapshots > 0);
assert.ok(status.rejectedSnapshots >= 0);
assert.ok(status.acceptedUnderlyingItems > 0);
assert.equal(status.bundledPath, "apps/web/src/data/daily-source-refreshes.json");
assert.equal(status.deployPath, "personal-brief commit -> deploy-web");

console.log("daily-automation-status.test.ts: ok");
