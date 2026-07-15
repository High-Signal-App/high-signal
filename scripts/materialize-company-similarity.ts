import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CompanyUniverseArtifact,
  UniverseCompany,
} from '../apps/web/src/app/case-studies/data';
import {
  MATERIALIZED_SIMILARITY_VERSION,
  buildReciprocalSimilarityGraph,
} from '../apps/web/src/app/case-studies/company-search';
import { writeWebCompanyUniverseArtifact } from './company-universe-web-artifact';

const ROOT = resolve(__dirname, '..');
const ARTIFACT_PATH = resolve(ROOT, 'apps/web/src/data/company-universe.json');
const TEMP_PATH = `${ARTIFACT_PATH}.tmp`;
const CANDIDATE_LIMIT = 24;
const MAX_PEERS = 6;

async function main() {
  const artifact = JSON.parse(await readFile(ARTIFACT_PATH, 'utf8')) as CompanyUniverseArtifact;
  const companies = artifact.companies as UniverseCompany[];
  const graph = buildReciprocalSimilarityGraph(companies, {
    candidateLimit: CANDIDATE_LIMIT,
    maxPeersPerCompany: MAX_PEERS,
  });

  for (const company of companies) {
    company.competitors = graph.edgesBySlug.get(company.slug) ?? [];
    company.similarityVersion = MATERIALIZED_SIMILARITY_VERSION;
  }

  const generatedAt = new Date().toISOString();
  artifact.competitorMapping = {
    method:
      'offline reciprocal product-similarity graph: extracted concepts + description terms + bounded category/affiliation boosts',
    minimumScore: 0,
    maxCompetitorsPerCompany: MAX_PEERS,
  };
  artifact.similarityMapping = {
    generatedAt,
    algorithm: 'bounded-greedy-undirected-v1',
    version: MATERIALIZED_SIMILARITY_VERSION,
    candidateLimit: CANDIDATE_LIMIT,
    maxPeersPerCompany: MAX_PEERS,
    undirectedEdgeCount: graph.undirectedEdgeCount,
    companiesWithPeers: graph.companiesWithPeers,
    complete: graph.companiesWithPeers === companies.length,
  };

  await writeFile(TEMP_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  await rename(TEMP_PATH, ARTIFACT_PATH);
  const webArtifactBytes = await writeWebCompanyUniverseArtifact(artifact);
  console.log(
    JSON.stringify(
      {
        artifact: ARTIFACT_PATH,
        generatedAt,
        companies: companies.length,
        candidateEdges: graph.candidateEdgeCount,
        reciprocalEdges: graph.undirectedEdgeCount,
        companiesWithPeers: graph.companiesWithPeers,
        maxDegree: graph.maxDegree,
        webArtifactBytes,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
