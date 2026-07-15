import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CompanyUniverseArtifact } from '../apps/web/src/app/case-studies/data';
import {
  WEB_ARTIFACT_PATH,
  writeWebCompanyUniverseArtifact,
} from './company-universe-web-artifact';

const fullArtifactPath = resolve(__dirname, '../apps/web/src/data/company-universe.json');

async function main() {
  const artifact = JSON.parse(await readFile(fullArtifactPath, 'utf8')) as CompanyUniverseArtifact;
  const bytes = await writeWebCompanyUniverseArtifact(artifact);
  console.log(
    JSON.stringify({ artifact: WEB_ARTIFACT_PATH, companies: artifact.companyCount, bytes })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
