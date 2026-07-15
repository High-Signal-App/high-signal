import { rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CompanyUniverseArtifact,
  UniverseCompany,
} from '../apps/web/src/app/case-studies/data';

const ROOT = resolve(__dirname, '..');
export const WEB_ARTIFACT_PATH = resolve(ROOT, 'apps/web/src/data/company-universe-web.json');

type WebUniverseCompany = UniverseCompany & {
  searchMetadata: string[];
  sourceEvidenceCount: number;
};

export function buildWebCompanyUniverseArtifact(artifact: CompanyUniverseArtifact) {
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
    companies: artifact.companies.map(
      (company): WebUniverseCompany => ({
        slug: company.slug,
        name: company.name,
        description: company.description,
        category: company.category,
        investors: company.investors,
        sourceEvidence: [],
        sourceEvidenceCount: company.sourceEvidence.length,
        searchMetadata: [
          ...new Set(
            company.sourceEvidence
              .flatMap((item) => [
                item.cohort,
                item.program,
                item.location,
                item.website,
                item.status,
              ])
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
  artifact: CompanyUniverseArtifact
): Promise<number> {
  const tempPath = `${WEB_ARTIFACT_PATH}.tmp`;
  const contents = `${JSON.stringify(buildWebCompanyUniverseArtifact(artifact))}\n`;
  await writeFile(tempPath, contents);
  await rename(tempPath, WEB_ARTIFACT_PATH);
  return Buffer.byteLength(contents);
}
