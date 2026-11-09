import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompanyUniverseArtifact } from '../apps/web/src/app/case-studies/data';
import { evaluateCompany } from '../apps/web/public-corpus-policy.mjs';
import {
  applyCompanySupplements,
  canonicalSourceUrl,
  parseCompanySupplements,
  sha256,
  type CompanySupplement,
} from './company-universe-supplements';
import {
  buildWebCompanyUniverseArtifact,
  writeWebCompanyUniverseArtifact,
} from './company-universe-web-artifact';
import { buildCompanyUniverseSyncSql, companyUniverseRunId } from './sync-company-universe';

const asOf = '2026-11-09T12:00:00Z';
const base: CompanyUniverseArtifact = {
  generatedAt: '2026-07-01T00:00:00Z',
  generatedBy: 'fixture',
  strictHighSignalOnly: true,
  companyCount: 1,
  sourceInputs: [{ id: 'yc-company-directory', label: 'YC', url: 'https://yc.example/' }],
  sourceStats: [
    {
      id: 'yc-company-directory',
      label: 'YC',
      fetchedCount: 1,
      uniqueCompanyCount: 1,
      providerReportedCount: 1,
      reconciled: true,
    },
  ],
  competitorMapping: { method: 'fixture', minimumScore: 1, maxCompetitorsPerCompany: 3 },
  companies: [
    {
      slug: 'acme',
      name: 'Acme',
      description: 'Acme builds useful workflow software. '.repeat(6),
      category: 'Software',
      investors: ['YC'],
      sourceEvidence: [
        {
          source: 'yc-company-directory',
          sourceUrl: 'https://yc.example/acme',
          title: 'Acme',
          fund: 'YC',
          position: 1,
          description: 'Original directory description',
          website: 'https://www.acme.example/',
        },
      ],
      competitors: [{ slug: 'peer', score: 60, reason: 'shared product terms: workflow software' }],
      entities: [
        { text: 'workflow', label: 'product', score: 1 },
        { text: 'software', label: 'product', score: 1 },
      ],
    },
  ],
};
const accepted: CompanySupplement = {
  id: 'acme-official-20261109',
  companySlug: 'acme',
  expectedName: 'Acme',
  expectedDirectoryUrl: 'https://yc.example/acme',
  expectedWebsiteHost: 'acme.example',
  expectedDescriptionSha256: sha256(base.companies[0].description),
  capture: {
    sourceUrl: 'https://www.acme.example/?utm_source=review',
    finalUrl: 'https://acme.example/#product',
    fetchedAt: '2026-11-09T10:00:00Z',
    contentSha256: 'a'.repeat(64),
    claim: 'Acme describes software for managing workflows.',
    excerpt: 'Software for your workflows',
    sourceCompanyIdentity: {
      name: 'Acme',
      canonicalWebsite: 'https://acme.example/',
      identityBasis: 'PRIVATE_IDENTITY',
    },
  },
  review: {
    state: 'accepted',
    reviewedAt: '2026-11-09T11:00:00Z',
    reviewer: 'fixture-reviewer',
    validUntil: '2026-12-09T11:00:00Z',
    supportRationale: 'PRIVATE_SUPPORT',
    identityRationale: 'PRIVATE_REVIEW',
  },
};
const clone = <T>(value: T): T => structuredClone(value);
const apply = (entry: CompanySupplement, artifact = base, time = asOf) =>
  applyCompanySupplements(artifact, [entry], { asOf: time });
const untouched = clone(base);
const result = apply(accepted);
assert.deepEqual(result.outcomes, [{ id: accepted.id, status: 'applied' }]);
assert.deepEqual(base, untouched);
assert.equal(evaluateCompany(base.companies[0]).eligible, false);
assert.equal(evaluateCompany(result.artifact.companies[0]).eligible, true);
assert.equal(result.artifact.companies[0].sourceEvidence.length, 2);
assert.deepEqual(
  { ...result.artifact.companies[0], sourceEvidence: base.companies[0].sourceEvidence },
  base.companies[0]
);
for (const field of [
  'generatedAt',
  'generatedBy',
  'companyCount',
  'sourceInputs',
  'sourceStats',
  'competitorMapping',
] as const) {
  assert.deepEqual(result.artifact[field], base[field]);
}
assert.deepEqual(applyCompanySupplements(result.artifact, [accepted], { asOf }), result);
const removed = applyCompanySupplements(result.artifact, [], { asOf });
assert.deepEqual(removed.artifact.companies, base.companies);
const changedDescription = clone(result.artifact);
changedDescription.companies[0].description += ' Changed description.';
const staleDescription = apply(accepted, changedDescription);
assert.equal(staleDescription.outcomes[0].status, 'description-mismatch');
assert.deepEqual(
  staleDescription.artifact.companies[0].sourceEvidence,
  base.companies[0].sourceEvidence
);
const changedIdentity = clone(result.artifact);
changedIdentity.companies[0].name = 'Different company';
const staleIdentity = apply(accepted, changedIdentity);
assert.equal(staleIdentity.outcomes[0].status, 'identity-mismatch');
assert.deepEqual(
  staleIdentity.artifact.companies[0].sourceEvidence,
  base.companies[0].sourceEvidence
);
assert.deepEqual(
  apply(accepted, result.artifact, '2026-12-09T11:00:00Z').artifact.companies,
  base.companies
);

const cases: Array<[string, (entry: CompanySupplement) => void]> = [
  [
    'pending',
    (entry) => {
      entry.review = { state: 'pending', reason: 'awaiting review' };
    },
  ],
  [
    'rejected',
    (entry) => {
      entry.review = { state: 'rejected', reason: 'unsupported' };
    },
  ],
  [
    'expired',
    (entry) => {
      if (entry.review.state === 'accepted') entry.review.validUntil = asOf;
    },
  ],
  [
    'not-yet-current',
    (entry) => {
      if (entry.review.state === 'accepted') entry.review.reviewedAt = '2026-11-10T00:00:00Z';
    },
  ],
  [
    'unknown-company',
    (entry) => {
      entry.companySlug = 'unknown';
    },
  ],
  [
    'identity-mismatch',
    (entry) => {
      entry.expectedName = 'Other';
    },
  ],
  [
    'identity-mismatch',
    (entry) => {
      entry.expectedDirectoryUrl = 'https://yc.example/other';
    },
  ],
  [
    'identity-mismatch',
    (entry) => {
      entry.expectedWebsiteHost = 'other.example';
    },
  ],
  [
    'identity-mismatch',
    (entry) => {
      entry.capture.finalUrl = 'https://unrelated.example/';
    },
  ],
  [
    'identity-mismatch',
    (entry) => {
      entry.capture.sourceCompanyIdentity.name = 'Other';
    },
  ],
  [
    'description-mismatch',
    (entry) => {
      entry.expectedDescriptionSha256 = 'b'.repeat(64);
    },
  ],
];
for (const [status, change] of cases) {
  const entry = clone(accepted);
  change(entry);
  const withheld = apply(entry);
  assert.equal(withheld.outcomes[0].status, status);
  assert.deepEqual(withheld.artifact.companies, base.companies);
  assert.equal(evaluateCompany(withheld.artifact.companies[0]).eligible, false);
}
const duplicateBase = clone(base);
duplicateBase.companies[0].sourceEvidence[0].sourceUrl =
  'https://www.acme.example/?utm_campaign=directory#x';
const duplicate = clone(accepted);
duplicate.expectedDirectoryUrl = 'https://acme.example/';
assert.equal(apply(duplicate, duplicateBase).outcomes[0].status, 'duplicate-source');
const another = clone(accepted);
another.id = 'z-acme';
another.capture.finalUrl = 'https://acme.example/product';
assert.deepEqual(
  applyCompanySupplements(base, [accepted, another], { asOf }),
  applyCompanySupplements(base, [another, accepted], { asOf })
);
assert.deepEqual(
  applyCompanySupplements(base, [accepted, another], { asOf }).outcomes.map((item) => item.status),
  ['applied', 'duplicate-source']
);
assert.equal(
  canonicalSourceUrl('https://www.acme.example/?utm_source=a&b=2&a=1#x'),
  'https://acme.example/?a=1&b=2'
);
for (const change of [
  (entry: Record<string, any>) => {
    entry.extra = 'unknown';
  },
  (entry: Record<string, any>) => {
    entry.expectedDescriptionSha256 = 'bad';
  },
  (entry: Record<string, any>) => {
    entry.capture.fetchedAt = '2026-02-30T00:00:00Z';
  },
  (entry: Record<string, any>) => {
    entry.capture.sourceUrl = 'http://acme.example/';
  },
  (entry: Record<string, any>) => {
    entry.capture.excerpt = 'word '.repeat(26).trim();
  },
  (entry: Record<string, any>) => {
    entry.review.state = 'automatic';
  },
]) {
  const entry = clone(accepted);
  change(entry);
  assert.throws(() => apply(entry));
}
assert.throws(() => parseCompanySupplements({ schemaVersion: 2, entries: [] }));
assert.throws(() => parseCompanySupplements({ schemaVersion: 1, entries: [accepted, accepted] }));
for (const field of ['description', 'entities', 'competitors'] as const) {
  const insufficient = clone(base);
  if (field === 'description') insufficient.companies[0].description = 'Short';
  else insufficient.companies[0][field] = [];
  const entry = clone(accepted);
  entry.expectedDescriptionSha256 = sha256(insufficient.companies[0].description);
  assert.equal(evaluateCompany(apply(entry, insufficient).artifact.companies[0]).eligible, false);
}
const web = buildWebCompanyUniverseArtifact(base, { supplements: [accepted], asOf });
assert.equal(web.companies[0].sourceEvidence[0].description, '');
assert.equal(web.companies[0].sourceEvidenceCount, 2);
assert.equal(
  'excerpt' in web.companies[0].sourceEvidence[1] && web.companies[0].sourceEvidence[1].excerpt,
  accepted.capture.excerpt
);
const serialized = JSON.stringify(web);
for (const field of [
  'PRIVATE_',
  'reviewer',
  'validUntil',
  'identityBasis',
  'fund":"Acme',
  'position":2',
])
  assert.equal(serialized.includes(field), false);
const sql = buildCompanyUniverseSyncSql(result.artifact);
assert.ok(sql.includes('reviewed-company-claim'));
assert.ok(sql.includes(accepted.capture.contentSha256));
assert.ok(sql.includes(accepted.capture.claim));
assert.equal(sql.includes('PRIVATE_'), false);
assert.equal(sql.includes('reviewer'), false);
assert.notEqual(companyUniverseRunId(base), companyUniverseRunId(result.artifact));
const expired = apply(accepted, base, '2026-12-10T00:00:00Z');
assert.notEqual(companyUniverseRunId(expired.artifact), companyUniverseRunId(result.artifact));
async function checkWriter() {
  const directory = await mkdtemp(join(tmpdir(), 'high-signal-supplements-test-'));
  const outputPath = join(directory, 'web.json');
  const parallelPath = join(directory, 'parallel.json');
  try {
    await writeWebCompanyUniverseArtifact(base, { supplements: [accepted], asOf, outputPath });
    const first = await readFile(outputPath, 'utf8');
    const parallel = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        writeWebCompanyUniverseArtifact(base, {
          supplements: [accepted],
          asOf,
          outputPath: parallelPath,
        })
      )
    );
    assert.ok(parallel.every((result) => result.status === 'fulfilled'));
    assert.equal(await readFile(parallelPath, 'utf8'), first);
    const firstStat = await stat(outputPath);
    await writeWebCompanyUniverseArtifact(base, {
      supplements: [accepted],
      asOf: '2026-11-10T12:00:00Z',
      outputPath,
    });
    assert.equal(await readFile(outputPath, 'utf8'), first);
    assert.equal((await stat(outputPath)).mtimeMs, firstStat.mtimeMs);
    assert.equal(JSON.parse(first).supplementReview.asOf, asOf);
    const malformed = clone(accepted);
    malformed.capture.contentSha256 = 'invalid';
    await assert.rejects(
      writeWebCompanyUniverseArtifact(base, { supplements: [malformed], asOf, outputPath })
    );
    assert.equal(await readFile(outputPath, 'utf8'), first);
    await writeWebCompanyUniverseArtifact(base, {
      supplements: [accepted],
      asOf: '2026-12-09T11:00:00Z',
      outputPath,
    });
    const expiredArtifact = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(expiredArtifact.companies[0].sourceEvidence.length, 1);
    assert.deepEqual(expiredArtifact.supplementReview.appliedIds, []);
    assert.equal(expiredArtifact.supplementReview.asOf, '2026-12-09T11:00:00Z');
    assert.notEqual(await readFile(outputPath, 'utf8'), first);
  } finally {
    await unlink(outputPath);
    await unlink(parallelPath);
    await rmdir(directory);
  }
}

checkWriter()
  .then(() => console.log('company-universe supplements tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
