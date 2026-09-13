import assert from 'node:assert/strict';
import {
  calendarDate,
  timestampMs,
  validateBriefContent,
  validateBriefFreshness,
} from './verify-daily-brief-lib.mjs';

const now = new Date('2026-08-25T04:00:00.000Z');

assert.equal(calendarDate(now), '2026-08-25');
assert.equal(calendarDate('2026-08-24T20:00:00.000Z'), '2026-08-25');
assert.equal(timestampMs(1_777_000_000), 1_777_000_000_000);

const newsOnly = validateBriefContent({
  news: [
    {
      id: 'news-1',
      title: 'A retained public report',
      event_at: '2026-08-25T02:15:00.000Z',
      source_references: [{ url: 'https://example.com/report' }],
    },
  ],
  stocks: [],
  ideas: [],
  trends: [],
});
assert.deepEqual(newsOnly.counts, { news: 1, stocks: 0, ideas: 0, trends: 0 });
assert.equal(newsOnly.total, 1);

assert.equal(validateBriefContent({ news: [], stocks: [{}], ideas: [], trends: [] }).total, 1);
assert.throws(
  () => validateBriefContent({ news: [], stocks: [], ideas: [], trends: [] }),
  /news and signal sections are empty/
);
assert.throws(
  () => validateBriefContent({ news: {}, stocks: [], ideas: [], trends: [] }),
  /news section is not an array/
);
assert.throws(
  () =>
    validateBriefContent({
      news: [
        {
          title: 'Missing source',
          event_at: '2026-08-25T02:15:00.000Z',
          source_references: [],
        },
      ],
      stocks: [],
      ideas: [],
      trends: [],
    }),
  /no public source/
);

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
