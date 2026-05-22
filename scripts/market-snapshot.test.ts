#!/usr/bin/env tsx
import assert from "node:assert/strict";
import marketRefreshes from "../apps/web/src/data/market-refreshes.json";
import { buildMarketWatchSnapshot, marketRefreshDates, resolveMarketRefreshRecord } from "../apps/web/src/lib/market-watch";
import type { MarketRefreshRecord } from "@high-signal/shared";

const records = marketRefreshes as MarketRefreshRecord[];
assert.ok(records.length > 0, "market snapshot should include bundled refresh records");
assert.ok(records.every((record) => record.source === "stooq"), "market snapshot should identify Stooq as source");
assert.ok(records.every((record) => record.groups.length > 0), "each market refresh should have groups");
const latestRecord = records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;

const snapshot = buildMarketWatchSnapshot(new Date("2026-05-22T08:00:00.000Z"));
assert.equal(snapshot.source, "stooq");
assert.equal(snapshot.freshnessStatus, "fresh");
assert.equal(snapshot.nationalGroupCount, 2);
assert.equal(snapshot.internationalGroupCount, 1);
assert.ok(snapshot.quoteCount >= 10);
assert.equal(snapshot.latestRefreshAt, latestRecord.createdAt);
assert.equal(snapshot.selectedRefreshAt, latestRecord.createdAt);
assert.ok(snapshot.groups.some((group) => group.region === "international"));

const dates = marketRefreshDates(records);
assert.equal(dates[0], latestRecord.createdAt.slice(0, 10));
assert.ok(dates.includes("2026-05-21"));

const previous = buildMarketWatchSnapshot(new Date("2026-05-22T08:00:00.000Z"), "2026-05-21");
assert.equal(previous.selectedRefreshDate, "2026-05-21");
assert.equal(previous.sourceDateShifted, false);
assert.notEqual(previous.selectedRefreshAt, snapshot.selectedRefreshAt);

const fallback = buildMarketWatchSnapshot(new Date("2026-05-22T08:00:00.000Z"), "1900-01-01");
assert.equal(fallback.selectedRefreshDate, dates.at(-1));
assert.equal(fallback.sourceDateShifted, true);
assert.equal(resolveMarketRefreshRecord(records, "2026-05-21")?.createdAt.slice(0, 10), "2026-05-21");

console.log("market-snapshot.test.ts: ok");
