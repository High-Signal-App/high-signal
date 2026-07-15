import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSourceStats,
  mapCompetitors,
  mergeCompanies,
  nextAntlerPage,
  parseAntlerPage,
  parseOfficialA16z,
  parseTechstarsClientConfig,
  parseTechstarsDocuments,
  parseYcClientConfig,
  parseYcHits,
  validateCoverage,
} from './company-universe.lib';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures/company-universe', name), 'utf8');

const ycConfig = parseYcClientConfig(fixture('yc.html'));
assert.deepEqual(ycConfig, { appId: 'APP123', apiKey: 'public-key' });
const ycPayload = JSON.parse(fixture('yc.json')) as Parameters<
  typeof parseYcHits
>[0] extends infer T
  ? { hits: T }
  : never;
const yc = parseYcHits(ycPayload.hits);
assert.equal(yc.length, 1);
assert.equal(yc[0].cohort, 'Winter 2026');
assert.equal(yc[0].sourceUrl, 'https://www.ycombinator.com/companies/acme-ai');
assert.match(yc[0].description, /searchable operating memory/);

const antlerHtml = fixture('antler.html');
const antler = parseAntlerPage(antlerHtml, 1);
assert.equal(antler.length, 1);
assert.equal(antler[0].title, 'Beacon Health');
assert.equal(antler[0].cohort, 'Antler 2025');
assert.equal(antler[0].program, 'Health and BioTech');
assert.equal(nextAntlerPage(antlerHtml), 2);

const a16z = parseOfficialA16z(fixture('a16z.html'));
assert.deepEqual(
  a16z.map((item) => item.title),
  ['Cloud Harbor']
);

const techstarsConfig = parseTechstarsClientConfig(fixture('techstars.html'));
assert.deepEqual(techstarsConfig, {
  baseUrl: 'https://typesense.example',
  apiKey: 'search-only',
});
const techstarsPayload = JSON.parse(fixture('techstars.json')) as {
  hits: Array<{ document: Parameters<typeof parseTechstarsDocuments>[0][number] }>;
};
const techstars = parseTechstarsDocuments(techstarsPayload.hits.map((hit) => hit.document));
assert.equal(techstars.length, 1);
assert.equal(techstars[0].program, 'Techstars Bangalore');

const companies = mergeCompanies([...yc, ...antler, ...a16z, ...techstars]);
const acme = companies.find((company) => company.slug === 'acme-ai');
assert.ok(acme);
assert.deepEqual(acme.investors, ['Techstars', 'Y Combinator']);
assert.equal(acme.sourceEvidence.length, 2);

const stats = buildSourceStats([...yc, ...antler, ...a16z, ...techstars], {
  'yc-company-directory': 1,
  'techstars-portfolio': 1,
});
validateCoverage(companies, stats, {
  'yc-company-directory': 1,
  'antler-portfolio': 1,
  'a16z-investment-list': 1,
  'techstars-portfolio': 1,
});
assert.equal(
  stats.every((stat) => stat.fetchedCount === 1),
  true
);

const mapped = mapCompetitors(
  mergeCompanies([
    ...yc,
    ...antler,
    ...a16z,
    ...techstars,
    {
      ...yc[0],
      position: 2,
      title: 'Acme Finance',
      description: 'AI workflow automation for finance operators.',
      website: 'https://finance.acme.example',
    },
  ])
);
assert.equal(
  mapped.every((company) => company.competitors.length <= 6),
  true
);
assert.equal(
  mapped.some((company) => company.competitors.some((edge) => edge.reason.length > 0)),
  true
);

assert.throws(
  () =>
    validateCoverage(companies, stats, {
      'yc-company-directory': 2,
      'antler-portfolio': 1,
      'a16z-investment-list': 1,
      'techstars-portfolio': 1,
    }),
  /yc-company-directory returned 1/
);

console.log('company-universe tests passed');
