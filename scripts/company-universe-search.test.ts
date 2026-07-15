import assert from 'node:assert/strict';
import type { UniverseCompany } from '../apps/web/src/app/case-studies/data';
import artifact from '../apps/web/src/data/company-universe.json';
import {
  buildReciprocalSimilarityGraph,
  getSimilarCompanyCluster,
  searchCompanyUniverse,
} from '../apps/web/src/app/case-studies/company-search';

function company(overrides: Partial<UniverseCompany> & Pick<UniverseCompany, 'name' | 'slug'>) {
  return {
    description: '',
    category: 'Other',
    investors: ['Y Combinator'],
    sourceEvidence: [],
    competitors: [],
    ...overrides,
  } satisfies UniverseCompany;
}

const companies = [
  company({
    slug: 'ledger-loop',
    name: 'Ledger Loop',
    description: 'AI workflow automation for finance and accounting teams.',
    category: 'Fintech',
  }),
  company({
    slug: 'finance-ai-directory',
    name: 'Accounting Directory',
    description: 'Workflow automation for accounting leaders.',
    category: 'Fintech',
  }),
  company({
    slug: 'acme-health',
    name: 'Acme Health',
    description: 'Clinical workflow software for hospitals.',
    category: 'Healthcare',
    investors: ['Antler'],
    sourceEvidence: [
      {
        source: 'antler-portfolio',
        sourceUrl: 'https://www.antler.co/portfolio',
        fund: 'Antler',
        position: 1,
        title: 'Acme Health',
        description: 'Clinical workflow software for hospitals.',
        cohort: 'Antler 2025',
        location: 'India',
      },
    ],
  }),
  company({
    slug: 'acme-health-insights',
    name: 'Acme Health Insights',
    description: 'Market intelligence mentioning Acme Health.',
    category: 'Data and analytics',
  }),
];

companies[0].competitors = [
  {
    slug: 'finance-ai-directory',
    name: 'Accounting Directory',
    score: 9,
    reason: 'same category: Fintech; shared terms: finance, ai',
  },
  {
    slug: 'missing-company',
    name: 'Missing Company',
    score: 8,
    reason: 'not present in the artifact',
  },
];

const descriptive = searchCompanyUniverse(companies, 'what companies do AI workflow finance');
assert.equal(descriptive.total, 1);
assert.equal(descriptive.companies[0]?.slug, 'ledger-loop');

const exactName = searchCompanyUniverse(companies, 'Acme Health');
assert.equal(exactName.companies[0]?.slug, 'acme-health');

const affiliationAndLocation = searchCompanyUniverse(companies, 'Antler India');
assert.equal(affiliationAndLocation.total, 1);
assert.equal(affiliationAndLocation.companies[0]?.slug, 'acme-health');

const affiliationAlias = searchCompanyUniverse(companies, 'YC');
assert.equal(affiliationAlias.total, 3);

const a16zCompanies = [
  company({
    slug: 'a16z-company',
    name: 'A16z Company',
    investors: ['Andreessen Horowitz'],
  }),
];
assert.equal(searchCompanyUniverse(a16zCompanies, 'a16z').total, 1);

const capped = searchCompanyUniverse(companies, 'health', 1);
assert.equal(capped.total, 2);
assert.equal(capped.companies.length, 1);

assert.deepEqual(searchCompanyUniverse(companies, '').companies, []);

const genericCrossCategoryCluster = getSimilarCompanyCluster(
  [
    company({
      slug: 'generic-ai',
      name: 'Generic AI',
      description: 'A company that allows users to change how they work by providing a platform.',
      category: 'AI agents',
    }),
    company({
      slug: 'generic-learning',
      name: 'Generic Learning',
      description: 'A service that allows users to change the way they work across a platform.',
      category: 'HR and talent',
    }),
  ],
  company({
    slug: 'generic-ai',
    name: 'Generic AI',
    description: 'A company that allows users to change how they work by providing a platform.',
    category: 'AI agents',
  })
);
assert.deepEqual(genericCrossCategoryCluster, []);

const cluster = getSimilarCompanyCluster(companies, companies[0], 1);
assert.equal(cluster.length, 1);
assert.equal(cluster[0]?.company.slug, 'finance-ai-directory');
assert.match(cluster[0]?.reason ?? '', /shared product terms/);

const reciprocalFixture = [
  company({
    slug: 'memory-capture',
    name: 'Memory Capture',
    description: 'Searchable memory from screen and audio context.',
    category: 'AI agents',
  }),
  company({
    slug: 'context-layer',
    name: 'Context Layer',
    description: 'Searchable context and memory for autonomous agents.',
    category: 'AI agents',
  }),
  company({
    slug: 'agent-memory',
    name: 'Agent Memory',
    description: 'Persistent memory infrastructure for AI assistants.',
    category: 'AI agents',
  }),
];
const reciprocalGraph = buildReciprocalSimilarityGraph(reciprocalFixture, {
  candidateLimit: 3,
  maxPeersPerCompany: 2,
});
assert.equal(reciprocalGraph.maxDegree <= 2, true);
for (const [slug, peers] of reciprocalGraph.edgesBySlug) {
  for (const peer of peers) {
    const reverse = reciprocalGraph.edgesBySlug
      .get(peer.slug)
      ?.find((candidate) => candidate.slug === slug);
    assert.ok(reverse, `${slug} -> ${peer.slug} must be reciprocal`);
    assert.equal(reverse.score, peer.score);
    assert.equal(reverse.reason, peer.reason);
  }
}

const snapshotCompanies = artifact.companies as UniverseCompany[];
const snapshotBySlug = new Map(snapshotCompanies.map((company) => [company.slug, company]));
const screenpipe = snapshotCompanies.find((item) => item.slug === 'screenpipe');
assert.ok(screenpipe, 'Screenpipe must remain discoverable from official YC evidence');
assert.equal(screenpipe.investors.includes('Y Combinator'), true);
assert.equal(
  screenpipe.entities?.some((entity) => entity.text.toLowerCase() === 'searchable memory'),
  true
);
const screenpipeCluster = getSimilarCompanyCluster(snapshotCompanies, screenpipe);
const screenpipePeerSlugs = new Set(screenpipeCluster.map(({ company }) => company.slug));
assert.equal(screenpipePeerSlugs.has('airweave'), true);
const clarum = snapshotBySlug.get('clarum');
assert.ok(clarum, 'Clarum must remain in the official-source artifact');
assert.equal(
  clarum.competitors.some((peer) => peer.slug === 'platzi'),
  false,
  'common prose alone must not link Clarum and Platzi'
);
assert.equal(artifact.entityExtraction.complete, true);
assert.equal(artifact.similarityMapping.complete, true);
assert.equal(artifact.similarityMapping.maxPeersPerCompany, 6);
for (const company of snapshotCompanies) {
  assert.equal(company.similarityVersion, 1);
  assert.equal(company.competitors.length <= 6, true);
  for (const peer of company.competitors) {
    const reverse = snapshotBySlug
      .get(peer.slug)
      ?.competitors.find((candidate) => candidate.slug === company.slug);
    assert.ok(reverse, `${company.slug} -> ${peer.slug} must be reciprocal`);
    assert.equal(reverse.score, peer.score);
    assert.equal(reverse.reason, peer.reason);
  }
}

console.log('company-universe search tests passed');
