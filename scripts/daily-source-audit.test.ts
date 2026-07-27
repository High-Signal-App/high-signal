#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import bundledRefreshes from '../apps/web/src/data/daily-source-refreshes.json';
import {
  buildDailySourceQualityAudit,
  resolveAcceptedRefreshDate,
  type ProductFlowRefreshRecord,
} from '../apps/web/src/lib/daily-intelligence';

const records = bundledRefreshes as ProductFlowRefreshRecord[];
const date = resolveAcceptedRefreshDate(records, '2026-05-22');

assert.equal(date, '2026-05-22');

const audit = buildDailySourceQualityAudit(records, date);
const totalRows = audit.acceptedSnapshots + audit.rejectedSnapshots + audit.missingSources;

assert.equal(audit.rows.length, audit.configuredSources);
assert.equal(totalRows, audit.configuredSources);
assert.ok(audit.configuredSources >= 69);
assert.ok(audit.acceptedSnapshots > 0);
assert.ok(audit.statusByClass.some((item) => item.k === 'regional'));
assert.ok(audit.statusByClass.some((item) => item.k === 'small-business'));
assert.ok(audit.statusByClass.some((item) => item.k === 'startup-builder'));
assert.ok(audit.actions.length > 0);
assert.ok(audit.rows.every((row) => row.sourceId && row.label && row.sourceType));

console.log('daily-source-audit.test.ts: ok');
