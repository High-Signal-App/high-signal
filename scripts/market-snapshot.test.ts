#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import marketRefreshes from '../apps/web/src/data/market-refreshes.json';
import {
  buildMarketWatchSnapshot,
  marketRefreshDates,
  resolveMarketRefreshRecord,
} from '../apps/web/src/lib/market-watch';
import type { MarketRefreshRecord } from '@high-signal/shared';

const records = marketRefreshes as MarketRefreshRecord[];
assert.ok(records.length > 0, 'market snapshot should include bundled refresh records');
assert.ok(
  records.every((record) => record.source === 'yahoo'),
  'market snapshot should identify Yahoo as source'
);
assert.ok(
  records.every((record) => record.groups.length > 0),
  'each market refresh should have groups'
);
const latestRecord = records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;

const currentTime = new Date(Date.parse(latestRecord.createdAt) + 3_600_000);
const snapshot = buildMarketWatchSnapshot(currentTime);
assert.equal(snapshot.source, 'yahoo');
assert.equal(snapshot.nationalGroupCount, 2);
assert.equal(snapshot.internationalGroupCount, 1);
assert.ok(snapshot.quoteCount >= 10);
assert.equal(snapshot.latestRefreshAt, latestRecord.createdAt);
assert.equal(snapshot.selectedRefreshAt, latestRecord.createdAt);
assert.ok(snapshot.groups.some((group) => group.region === 'international'));

const dates = marketRefreshDates(records);
assert.equal(dates[0], latestRecord.createdAt.slice(0, 10));
assert.ok(dates.includes(latestRecord.createdAt.slice(0, 10)));

const fallback = buildMarketWatchSnapshot(currentTime, '1900-01-01');
assert.equal(fallback.selectedRefreshDate, null);
assert.equal(fallback.quoteCount, 0);
assert.equal(fallback.sourceDateShifted, false);
assert.equal(
  resolveMarketRefreshRecord(records, latestRecord.createdAt.slice(0, 10))?.createdAt,
  latestRecord.createdAt
);

console.log('market-snapshot.test.ts: ok');

const fixture = structuredClone(latestRecord);
fixture.createdAt = '2026-10-29T10:00:00Z';
for (const group of fixture.groups) for (const quote of group.quotes) quote.date = '2026-10-29';
const now = new Date('2026-10-29T11:00:00Z');
assert.equal(buildMarketWatchSnapshot(now, null, [fixture]).freshnessStatus, 'fresh');
for (const group of fixture.groups) for (const quote of group.quotes) quote.date = '2026-10-01';
assert.equal(buildMarketWatchSnapshot(now, null, [fixture]).freshnessStatus, 'stale');
assert.equal(
  buildMarketWatchSnapshot(new Date('2026-10-28T00:00:00Z'), null, [fixture]).quoteCount,
  0
);
