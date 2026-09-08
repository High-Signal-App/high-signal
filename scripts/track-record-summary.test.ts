import assert from 'node:assert/strict';
import { summarizeTrackBuckets } from '../apps/web/src/lib/track-record-summary';

const sample = summarizeTrackBuckets([
  { signalType: 'a', hit: 2, miss: 0, push: 0, pending: 25, total: 27, hitRate: 1 },
  { signalType: 'b', hit: 0, miss: 1, push: 0, pending: 64, total: 65, hitRate: 0 },
  { signalType: 'c', hit: 0, miss: 0, push: 0, pending: 2000, total: 2000, hitRate: null },
]);
assert.equal(sample.resolved, 3);
assert.equal(sample.pending, 2089);
assert.equal(sample.total, 2092);
assert.equal(sample.hitRate, 2 / 3);
assert.equal(sample.smallResolvedSample, true);
const pendingOnly = summarizeTrackBuckets([
  { signalType: 'pending', hit: 0, miss: 0, push: 5, pending: 100, total: 105, hitRate: null },
]);
assert.equal(pendingOnly.resolved, 0);
assert.equal(pendingOnly.hitRate, null);
assert.equal(pendingOnly.smallResolvedSample, false);
assert.equal(summarizeTrackBuckets([]).hitRate, null);
console.log('PASS: pending and push records never inflate the resolved hit-rate sample');
