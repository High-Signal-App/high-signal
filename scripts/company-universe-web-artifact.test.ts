import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import fullArtifact from '../apps/web/src/data/company-universe.json';
import webArtifact from '../apps/web/src/data/company-universe-web.json';
import type { CompanyUniverseArtifact } from '../apps/web/src/app/case-studies/data';
import {
  WEB_ARTIFACT_PATH,
  buildWebCompanyUniverseArtifact,
} from './company-universe-web-artifact';

const expected = buildWebCompanyUniverseArtifact(fullArtifact as CompanyUniverseArtifact);
assert.deepEqual(webArtifact, expected);
assert.equal(webArtifact.companies.length, fullArtifact.companies.length);
assert.equal(
  webArtifact.companies.every((company) => company.sourceEvidence.length === 0),
  true
);
assert.equal(
  webArtifact.companies.every(
    (company) =>
      company.sourceEvidenceCount ===
      fullArtifact.companies.find(({ slug }) => slug === company.slug)?.sourceEvidence.length
  ),
  true
);
assert.equal(
  webArtifact.companies.some((company) => company.searchMetadata.length > 0),
  true
);
assert.equal(statSync(WEB_ARTIFACT_PATH).size < 24 * 1024 * 1024, true);
assert.doesNotThrow(() => JSON.parse(readFileSync(WEB_ARTIFACT_PATH, 'utf8')));

console.log('company-universe web artifact tests passed');
