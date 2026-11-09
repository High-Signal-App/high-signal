import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import type {
  CompanyUniverseArtifact,
  UniverseCompany,
} from '../apps/web/src/app/case-studies/data';
import {
  applyCompanySupplements,
  isSupplementEvidence,
  loadCompanySupplements,
  publicSourceEvidence,
  type CompanySupplement,
} from './company-universe-supplements';

const ROOT = resolve(__dirname, '..');
export const WEB_ARTIFACT_PATH = resolve(ROOT, 'apps/web/src/data/company-universe-web.json');

type WebUniverseCompany = UniverseCompany & {
  searchMetadata: string[];
  sourceEvidenceCount: number;
};

export function buildWebCompanyUniverseArtifact(
  base: CompanyUniverseArtifact,
  options: { supplements: readonly CompanySupplement[]; asOf: string }
) {
  const { artifact } = applyCompanySupplements(base, options.supplements, options);
  return {
    generatedAt: artifact.generatedAt,
    generatedBy: artifact.generatedBy,
    strictHighSignalOnly: artifact.strictHighSignalOnly,
    companyCount: artifact.companyCount,
    sourceInputs: artifact.sourceInputs,
    sourceStats: artifact.sourceStats,
    competitorMapping: artifact.competitorMapping,
    entityExtraction: artifact.entityExtraction,
    similarityMapping: artifact.similarityMapping,
    supplementReview: artifact.supplementReview,
    companies: artifact.companies.map(
      (company): WebUniverseCompany => ({
        slug: company.slug,
        name: company.name,
        description: company.description,
        category: company.category,
        investors: company.investors,
        sourceEvidence: company.sourceEvidence.map((item) => publicSourceEvidence(item, true)),
        sourceEvidenceCount: company.sourceEvidence.length,
        searchMetadata: [
          ...new Set(
            company.sourceEvidence
              .flatMap((item) =>
                isSupplementEvidence(item)
                  ? []
                  : [item.cohort, item.program, item.location, item.website, item.status]
              )
              .filter((value): value is string => Boolean(value))
          ),
        ],
        competitors: company.competitors.map(({ slug, score, reason }) => ({
          slug,
          score,
          reason,
        })),
        entities: company.entities,
        similarityVersion: company.similarityVersion,
      })
    ),
  };
}

export async function writeWebCompanyUniverseArtifact(
  artifact: CompanyUniverseArtifact,
  options: { supplements?: readonly CompanySupplement[]; asOf?: string; outputPath?: string } = {}
): Promise<number> {
  const outputPath = options.outputPath ?? WEB_ARTIFACT_PATH;
  const candidate = buildWebCompanyUniverseArtifact(artifact, {
    supplements: options.supplements ?? loadCompanySupplements(),
    asOf: options.asOf ?? new Date().toISOString(),
  });
  const contents = `${JSON.stringify(candidate)}\n`;
  let current: string | undefined;
  try {
    current = await readFile(outputPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (current !== undefined) {
    const previous = JSON.parse(current) as typeof candidate;
    const withoutReviewTime = (value: typeof candidate) => ({
      ...value,
      supplementReview: { ...value.supplementReview, asOf: undefined },
    });
    if (isDeepStrictEqual(withoutReviewTime(previous), withoutReviewTime(JSON.parse(contents)))) {
      return Buffer.byteLength(current);
    }
  }
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, contents, { flag: 'wx' });
    await rename(tempPath, outputPath);
  } finally {
    await unlink(tempPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return Buffer.byteLength(contents);
}
