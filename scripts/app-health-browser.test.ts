import assert from 'node:assert/strict';
import { isPublicAnalyticsPath, readingAction } from '../apps/web/src/lib/app-health-browser';

assert.equal(isPublicAnalyticsPath('/review'), false);
assert.equal(isPublicAnalyticsPath('/review/private'), false);
assert.equal(isPublicAnalyticsPath('/api/history/access'), false);
assert.equal(isPublicAnalyticsPath('/signals/public'), true);
assert.equal(
  readingAction(
    'https://source.example/private?email=secret@example.com',
    'https://highsignal.app'
  ),
  'source.opened'
);
assert.equal(
  readingAction('/signals/public?token=secret', 'https://highsignal.app'),
  'signal.opened'
);
assert.equal(readingAction('/review/private', 'https://highsignal.app'), null);
assert.equal(readingAction('mailto:secret@example.com', 'https://highsignal.app'), null);
console.log('App Health public route and action privacy checks passed');
