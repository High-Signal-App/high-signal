import assert from 'node:assert/strict';
import { guardPublicRequest } from '../apps/web/abuse-guard.mjs';

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
assert.equal(crawlerDataResponse?.status, 404);
assert.equal(crawlerDataResponse?.headers.get('x-robots-tag'), 'noindex, nofollow');

const verifiedCrawlerContent = new Request('https://highsignal.app/brief', {
  headers: { 'user-agent': 'GPTBot/1.4' },
});
Object.defineProperty(verifiedCrawlerContent, 'cf', {
  value: { verifiedBotCategory: 'AI Crawler' },
});
assert.equal(guardPublicRequest(verifiedCrawlerContent), null);

const normal = new Request('https://highsignal.app/brief');
assert.equal(guardPublicRequest(normal), null);

console.log('abuse guard tests passed');
