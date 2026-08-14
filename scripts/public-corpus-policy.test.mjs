#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  PUBLIC_CORPUS_POLICY_REVISION,
  evaluateCollection,
  evaluateCompany,
  evaluateDirectoryPage,
  evaluateEntity,
  evaluateSignal,
  robotsForVerdict,
} from '../apps/web/public-corpus-policy.mjs';

const provenance = {
  source: 'yc-company-directory',
  sourceUrl: 'https://www.ycombinator.com/companies/example',
  fund: 'Y Combinator',
  title: 'Example',
};

const qualifiedCompany = {
  description:
    'Example builds an evidence-backed workflow for engineering teams that need to compare operational software, retain source provenance, and understand the product differences before making a decision.',
  sourceEvidence: [
    provenance,
    {
      ...provenance,
      source: 'official-company-site',
      sourceUrl: 'https://example.com',
      fund: 'Company website',
    },
  ],
  entities: [
    { text: 'engineering teams', label: 'target customer', score: 0.8 },
    { text: 'workflow software', label: 'product', score: 0.7 },
  ],
  competitors: [{ slug: 'peer', score: 42, reason: 'shared product terms: workflow, engineering' }],
};

const first = evaluateCompany(qualifiedCompany);
const second = evaluateCompany(structuredClone(qualifiedCompany));
assert.deepEqual(first, second, 'unchanged evidence must produce a deterministic verdict');
assert.equal(first.eligible, true);
assert.equal(first.tier, 'substantive');
assert.equal(first.policyRevision, PUBLIC_CORPUS_POLICY_REVISION);
assert.equal(robotsForVerdict(first), undefined);

const affiliationOnly = evaluateCompany({
  ...qualifiedCompany,
  competitors: [
    {
      slug: 'cohort-peer',
      score: 6,
      reason: 'shared affiliation: Y Combinator; nearby official-directory cohort',
    },
  ],
});
assert.equal(affiliationOnly.eligible, false);
assert.deepEqual(affiliationOnly.reasons, ['no-product-supported-similarity']);
assert.deepEqual(robotsForVerdict(affiliationOnly), { index: false, follow: true });

const sparseCompany = evaluateCompany({
  description: '',
  sourceEvidence: [],
  entities: [],
  competitors: [],
});
assert.equal(sparseCompany.eligible, false);
assert.deepEqual(sparseCompany.reasons, [
  'description-under-160',
  'fewer-than-two-official-sources',
  'fewer-than-two-product-facets',
  'no-product-supported-similarity',
]);

assert.equal(
  evaluateSignal({
    reviewStatus: 'published',
    bodyMd: '# A cited signal\n\n'.padEnd(260, 'e'),
    evidenceUrls: ['https://example.com/source-one', 'https://example.com/source-two'],
  }).eligible,
  true
);
assert.equal(
  evaluateSignal({ reviewStatus: 'draft', bodyMd: '', evidenceUrls: [] }).eligible,
  false
);

assert.equal(evaluateEntity({ signalCount: 1 }).eligible, true);
assert.equal(evaluateEntity({ signalCount: 0, relationshipCount: 1 }).eligible, false);
assert.equal(evaluateCollection('entity-period', { childCount: 2 }, 2).eligible, true);
assert.equal(evaluateCollection('brief', { childCount: 1 }, 3).eligible, false);
assert.equal(
  evaluateCollection('taxonomy', { childCount: 3, hasProvenance: false }).eligible,
  false
);
assert.equal(evaluateDirectoryPage().eligible, false);

console.log('public corpus policy tests passed');
