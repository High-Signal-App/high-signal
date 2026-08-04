#!/usr/bin/env node

import assert from 'node:assert/strict';

import { buildPublicCorpusCandidates } from '../apps/web/public-corpus-records.mjs';
import {
  assertPublicCorpusReceipt,
  buildPublicCorpusReceipt,
} from '../apps/web/public-corpus-receipt.mjs';
import { htmlDisallowsIndexing } from '../apps/web/agent-edge.mjs';
import { robotsForVerdict, shouldIncludeInDiscovery } from '../apps/web/public-corpus-policy.mjs';

const companies = [
  {
    slug: 'qualified',
    description: 'A'.repeat(180),
    sourceEvidence: [
      { sourceUrl: 'https://example.com', source: 'official', fund: 'Fund', title: 'Qualified' },
    ],
    entities: [{ text: 'workflow' }, { text: 'teams' }],
    competitors: [{ slug: 'peer', reason: 'shared product terms: workflow' }],
  },
  { slug: 'withheld', description: '', sourceEvidence: [], entities: [], competitors: [] },
];
const signals = [
  {
    slug: 'qualified-signal',
    reviewStatus: 'published',
    bodyMd: '# Signal\n\n'.padEnd(260, 'x'),
    evidenceUrls: ['https://one.example', 'https://two.example'],
    primaryEntityId: 'ACME',
    signalType: 'demand_shift',
    publishedAt: '2026-08-01T00:00:00.000Z',
  },
];
const candidates = buildPublicCorpusCandidates({
  companies,
  signals,
  entities: [{ id: 'ACME' }],
  briefDates: [{ date: '2026-08-01', regionCount: 1, computedAt: '2026-08-01T01:00:00.000Z' }],
  directoryPageCount: 2,
});

for (const item of candidates) {
  const sitemapIncludes = shouldIncludeInDiscovery(item.verdict);
  const robots = robotsForVerdict(item.verdict);
  const robotsHtml = robots ? '<meta name="robots" content="noindex, follow">' : '';
  const agentIncludes = !htmlDisallowsIndexing(`<html><head>${robotsHtml}</head></html>`);
  assert.equal(agentIncludes, sitemapIncludes, `${item.path} discovery surfaces must agree`);
}

const first = buildPublicCorpusReceipt(candidates, null, new Date('2026-08-05T00:00:00Z'));
assert.equal(first.initialBaseline, true);
assert.equal(first.families.company.eligible, 1);
assert.equal(first.families.company.withheld, 1);
assert.equal(first.families['directory-page'].eligible, 0);
assert.doesNotThrow(() =>
  assertPublicCorpusReceipt(first, { requiredFamilies: ['company', 'signal', 'entity'] })
);

const withoutSignals = buildPublicCorpusReceipt(
  candidates.filter((item) => item.family !== 'signal'),
  first,
  new Date('2026-08-06T00:00:00Z')
);
assert.throws(
  () => assertPublicCorpusReceipt(withoutSignals, { requiredFamilies: ['signal'] }),
  /unexpectedly empty/
);

console.log('public corpus receipt and discovery parity tests passed');
