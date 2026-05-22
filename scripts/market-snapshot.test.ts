#!/usr/bin/env tsx
import assert from "node:assert/strict";
import marketRefreshes from "../apps/web/src/data/market-refreshes.json";
import { buildMarketWatchSnapshot } from "../apps/web/src/lib/market-watch";
import type { MarketRefreshRecord } from "@high-signal/shared";

const records = marketRefreshes as MarketRefreshRecord[];
assert.ok(records.length > 0, "market snapshot should include bundled refresh records");
assert.ok(records.every((record) => record.source === "stooq"), "market snapshot should identify Stooq as source");
assert.ok(records.every((record) => record.groups.length > 0), "each market refresh should have groups");

const snapshot = buildMarketWatchSnapshot(new Date("2026-05-22T08:00:00.000Z"));
assert.equal(snapshot.source, "stooq");
assert.equal(snapshot.freshnessStatus, "fresh");
assert.equal(snapshot.nationalGroupCount, 2);
assert.equal(snapshot.internationalGroupCount, 1);
assert.ok(snapshot.quoteCount >= 10);
assert.equal(snapshot.latestRefreshAt, "2026-05-22T07:26:09.133Z");
assert.ok(snapshot.groups.some((group) => group.region === "international"));

console.log("market-snapshot.test.ts: ok");
