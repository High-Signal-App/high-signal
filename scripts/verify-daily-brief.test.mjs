import assert from 'node:assert/strict';
import { calendarDate, timestampMs, validateBriefFreshness } from './verify-daily-brief-lib.mjs';

const now = new Date('2026-08-25T04:00:00.000Z');

assert.equal(calendarDate(now), '2026-08-25');
assert.equal(calendarDate('2026-08-24T20:00:00.000Z'), '2026-08-25');
assert.equal(timestampMs(1_777_000_000), 1_777_000_000_000);

const result = validateBriefFreshness(
  { generatedAt: '2026-08-25T03:30:00.000Z' },
  {
    date: '2026-08-25',
    latestEvidenceInputAt: '2026-08-25T02:30:00.000Z',
  },
  now
);
assert.equal(result.ageMs, 90 * 60 * 1000);

assert.throws(
  () =>
    validateBriefFreshness(
      { generatedAt: '2026-08-24T03:30:00.000Z' },
      { date: '2026-08-25', latestEvidenceInputAt: now.toISOString() },
      now
    ),
  /brief date/
);
assert.throws(
  () =>
    validateBriefFreshness(
      { generatedAt: '2026-08-25T03:30:00.000Z' },
      { date: '2026-08-25', latestEvidenceInputAt: '2026-08-25T01:59:59.000Z' },
      now
    ),
  /limit 2h/
);
assert.throws(
  () =>
    validateBriefFreshness(
      { generatedAt: '2026-08-25T03:30:00.000Z' },
      { date: '2026-08-25', latestEvidenceInputAt: '2026-08-25T04:06:00.000Z' },
      now
    ),
  /future-dated/
);

console.log('verify-daily-brief: freshness checks passed');
