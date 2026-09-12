import assert from 'node:assert/strict';
import { classifyTraffic, createTrafficSummary } from '../packages/shared/src/traffic';

const request = (agent: string) =>
  new Request('https://highsignal.app/signals?private=value', {
    headers: { 'user-agent': agent, 'cf-connecting-ip': '192.0.2.1' },
  });
assert.equal(classifyTraffic(request('Mozilla/5.0')), 'unknown');
assert.equal(classifyTraffic(request('Googlebot/2.1')), 'declared_bot');
assert.equal(classifyTraffic(request('curl/8')), 'automation');
const verified = request('Googlebot/2.1');
Object.defineProperty(verified, 'cf', { value: { botManagement: { verifiedBot: true } } });
assert.equal(classifyTraffic(verified), 'verified_bot');
let time = 0;
const summarize = createTrafficSummary(() => time);
assert.equal(summarize(verified)?.verified_bot, 1);
assert.equal(summarize(request('Mozilla/5.0')), null);
time = 60_000;
assert.deepEqual(summarize(request('curl/8')), {
  verified_bot: 0,
  declared_bot: 0,
  automation: 1,
  unknown: 1,
  requests: 2,
  window_ms: 60_000,
});
assert.equal(summarize(request('Googlebot/2.1')), null);
time = 120_000;
const second = summarize(request('Mozilla/5.0'));
assert.equal(second?.requests, 2);
assert.equal(second?.declared_bot, 1);
assert.ok(!JSON.stringify(second).includes('private'));
assert.ok(!JSON.stringify(second).includes('Googlebot'));
console.log('Traffic classification, bounded summaries and privacy checks passed.');
