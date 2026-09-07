import assert from 'node:assert/strict';
import { reviewSample } from '../apps/web/review-sample.mjs';

const play = 'https://play.google.com/store/apps/details?id=com.example&reviewId=one';
const apple = 'https://itunes.apple.com/us/review?id=123&reviewId=two';
const signal = {
  primaryEntityId: 'example',
  evidenceUrls: [play, apple],
  qualityScore: 99,
  confidence: 'high',
};
const copy = structuredClone(signal);
const result = reviewSample(signal);
assert.equal(result.count, 2);
assert.deepEqual(result.platforms, ['App Store', 'Play Store']);
assert.match(result.limitation, /trend is not established/);
assert.doesNotMatch(result.headline, /surge|spike/i);
assert.deepEqual(signal, copy, 'presentation must not rewrite stored evidence');
assert.equal(reviewSample({ evidenceUrls: [play, `${play}&hl=en`, play] }).count, 1);
assert.equal(
  reviewSample({ evidenceUrls: [play, play.replace('one', 'two')] }).platforms.length,
  1
);
for (const urls of [
  [],
  [play, 'https://example.com/report'],
  ['invalid'],
  ['https://play.google.com/store/apps/details?id=com.example'],
  ['https://play.google.com.evil.test/store/apps/details?id=a&reviewId=b'],
]) {
  assert.equal(
    reviewSample({ evidenceUrls: urls }),
    null,
    'unknown or mixed evidence must not be classified as review-only'
  );
}
assert.equal(reviewSample({}), null);
console.log('review sample qualification tests passed');
