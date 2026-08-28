import assert from 'node:assert/strict';
import {
  RUN_START_TOLERANCE_MS,
  closestRun,
  diggAcceptance,
  expectedRunAt,
} from './verify-issue-133-acceptance.mjs';

const target = expectedRunAt('2026-08-29', '02:30:00');
assert.equal(target.toISOString(), '2026-08-29T02:30:00.000Z');

const onTime = {
  id: 1,
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-08-29T02:30:48Z',
};
const tooLate = {
  ...onTime,
  id: 2,
  created_at: new Date(target.getTime() + RUN_START_TOLERANCE_MS + 1).toISOString(),
};
const wrongEvent = { ...onTime, id: 3, event: 'schedule' };
assert.equal(closestRun([tooLate, wrongEvent, onTime], target)?.id, 1);
assert.equal(closestRun([tooLate, wrongEvent], target), null);

assert.deepEqual(diggAcceptance({ verifiedCandidates: 1, medianFirstSeenToVerifiedMinutes: 89 }), {
  verifiedCandidates: 1,
  medianMinutes: 89,
  passed: true,
});
assert.equal(
  diggAcceptance({ verifiedCandidates: 1, medianFirstSeenToVerifiedMinutes: 90 }).passed,
  false
);
assert.equal(
  diggAcceptance({ verifiedCandidates: 0, medianFirstSeenToVerifiedMinutes: null }).passed,
  false
);

console.log('issue-133 acceptance: checks passed');
