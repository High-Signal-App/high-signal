import assert from 'node:assert/strict';
import mentions from '../fixtures/competitor-perception-mentions.json' assert { type: 'json' };
import { buildCompetitorPerceptionInbox, renderCompetitorPerceptionMarkdown } from './competitor-perception-inbox';

const report = buildCompetitorPerceptionInbox(mentions);

assert.equal(report.summary.mentionCount, 5);
assert.ok(report.summary.buckets.some((bucket) => bucket.bucket === 'pricing'));
assert.ok(report.summary.buckets.some((bucket) => bucket.bucket === 'feature_request'));
assert.match(report.monthlyReportReadyRecommendation, /source-trail|report|roadmap|source\/evidence/i);

const markdown = renderCompetitorPerceptionMarkdown(report);
assert.match(markdown, /Competitor Perception Signal Inbox/);
assert.match(markdown, /https:\/\/example.com\/hn\/high-signal-brief/);
assert.match(markdown, /Monthly-report recommendation/);

console.log('competitor perception inbox prototype ok');
