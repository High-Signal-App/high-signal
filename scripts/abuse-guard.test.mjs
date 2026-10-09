import assert from 'node:assert/strict';
import { createPublicRequestGuard, guardPublicRequest } from '../apps/web/abuse-guard.mjs';

const abusive = new Request('http://highsignal.app/daily?date=2020-01-01', {
  headers: { 'cf-connecting-ip': '93.123.109.102' },
});
const abusiveResponse = guardPublicRequest(abusive);
assert.equal(abusiveResponse?.status, 403);

const http = new Request('http://highsignal.app/brief?region=global', {
  headers: { 'cf-connecting-ip': '203.0.113.5' },
});
const redirect = guardPublicRequest(http);
assert.equal(redirect?.status, 308);
assert.equal(redirect?.headers.get('location'), 'https://highsignal.app/brief?region=global');

const verifiedCrawler = new Request('https://highsignal.app/data/github-archive?date=2026-07-01', {
  headers: {
    'cf-connecting-ip': '74.7.241.37',
    'user-agent': 'GPTBot/1.4',
  },
});
Object.defineProperty(verifiedCrawler, 'cf', {
  value: { verifiedBotCategory: 'AI Crawler' },
});
const crawlerDataResponse = guardPublicRequest(verifiedCrawler);
assert.equal(crawlerDataResponse, null, 'ordinary crawler reads remain accessible');

const verifiedCrawlerContent = new Request('https://highsignal.app/brief', {
  headers: { 'user-agent': 'GPTBot/1.4' },
});
Object.defineProperty(verifiedCrawlerContent, 'cf', {
  value: { verifiedBotCategory: 'AI Crawler' },
});
assert.equal(guardPublicRequest(verifiedCrawlerContent), null);

const verifiedCrawlerAggregate = new Request(
  'https://highsignal.app/signals/today?date=2026-07-01'
);
Object.defineProperty(verifiedCrawlerAggregate, 'cf', {
  value: { verifiedBotCategory: 'AI Crawler' },
});
assert.equal(guardPublicRequest(verifiedCrawlerAggregate), null);

const normal = new Request('https://highsignal.app/brief');
assert.equal(guardPublicRequest(normal), null);

let time = 0;
const guard = createPublicRequestGuard(() => time);
const burst = (ip = '203.0.113.8', path = '/data', method = 'GET') =>
  new Request(`https://highsignal.app${path}`, {
    method,
    headers: { 'cf-connecting-ip': ip },
  });
for (let i = 0; i < 120; i++) assert.equal(guard(burst()), null);
const limited = guard(burst());
assert.equal(limited?.status, 429);
assert.equal(limited?.headers.get('retry-after'), '60');
assert.equal(limited?.headers.get('cache-control'), 'no-store');
assert.equal(limited?.headers.get('x-high-signal-guard'), 'rate-limit');
assert.equal(guard(burst('203.0.113.9')), null, 'clients have separate budgets');
assert.equal(guard(burst(undefined, '/api/admin/publish', 'POST')), null);
assert.equal(guard(burst(undefined, '/api/company-universe/lookup')), null);
assert.equal(guard(burst(undefined, '/_next/static/build.js')), null);
assert.equal(guard(burst(undefined, '/logo.svg')), null);
assert.equal(guard(normal), null, 'local requests without provider client IP remain usable');
time = 59_500;
assert.equal(guard(burst())?.headers.get('retry-after'), '1');
time = 60_000;
assert.equal(guard(burst()), null, 'expired budgets recover');

console.log('abuse guard tests passed');
