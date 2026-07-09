#!/usr/bin/env tsx
/**
 * Persist the generated High Signal company universe into D1.
 *
 *   pnpm company-universe:sync         # local D1
 *   pnpm company-universe:sync:remote  # production D1
 *   pnpm company-universe:sync -- --dry-run
 *
 * The generated JSON remains a build/cache artifact. These D1 tables are the
 * product system of record after this script runs.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { escSql as esc } from './sync-signals.lib';

interface CompanyUniverseArtifact {
  generatedAt: string;
  generatedBy: string;
  strictHighSignalOnly: boolean;
  sourceInputs: Array<{ id: string; label: string; url: string }>;
  companies: Array<{
    slug: string;
    name: string;
    description: string;
    category: string;
    investors: string[];
    sourceEvidence: unknown[];
    competitors: Array<{ slug: string; name: string; score: number; reason: string }>;
  }>;
}

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_PATH = resolve(__root, 'apps/web/src/data/company-universe.json');
const TMP_DIR = resolve(__root, '.tmp');
const TMP_SQL = resolve(TMP_DIR, 'company-universe-sync.sql');
const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const dryRun = process.argv.includes('--dry-run');

function runId(generatedAt: string): string {
  return createHash('sha256').update(`company-universe:${generatedAt}`).digest('hex').slice(0, 16);
}

function parseArtifact(): CompanyUniverseArtifact {
  return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as CompanyUniverseArtifact;
}

function main() {
  const artifact = parseArtifact();
  const generatedMs = Date.parse(artifact.generatedAt);
  if (Number.isNaN(generatedMs)) {
    throw new Error(`invalid generatedAt in ${ARTIFACT_PATH}: ${artifact.generatedAt}`);
  }
  const generatedUnix = Math.floor(generatedMs / 1000);

  const competitorCount = artifact.companies.reduce(
    (sum, company) => sum + company.competitors.length,
    0
  );
  const sql: string[] = [
    'DELETE FROM company_universe_competitors;',
    'DELETE FROM company_universe_companies;',
    'DELETE FROM company_universe_runs;',
    `INSERT INTO company_universe_runs (id, generated_at, source_inputs_json, company_count, competitor_count, created_at) VALUES (${esc(runId(artifact.generatedAt))}, ${esc(artifact.generatedAt)}, ${esc(JSON.stringify(artifact.sourceInputs))}, ${artifact.companies.length}, ${competitorCount}, ${generatedUnix});`,
  ];

  for (const company of artifact.companies) {
    sql.push(
      `INSERT INTO company_universe_companies (slug, name, description, category, investors_json, source_evidence_json, generated_at, updated_at, status) VALUES (` +
        `${esc(company.slug)}, ${esc(company.name)}, ${esc(company.description)}, ${esc(company.category)}, ` +
        `${esc(JSON.stringify(company.investors))}, ${esc(JSON.stringify(company.sourceEvidence))}, ${esc(artifact.generatedAt)}, ${generatedUnix}, 'generated');`
    );
  }

  for (const company of artifact.companies) {
    for (const competitor of company.competitors) {
      sql.push(
        `INSERT INTO company_universe_competitors (company_slug, competitor_slug, score, reason, generated_at) VALUES (` +
          `${esc(company.slug)}, ${esc(competitor.slug)}, ${Math.round(competitor.score)}, ${esc(competitor.reason)}, ${esc(artifact.generatedAt)});`
      );
    }
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, `${sql.join('\n')}\n`);
  console.log(
    JSON.stringify(
      {
        artifact: ARTIFACT_PATH,
        sql: TMP_SQL,
        companies: artifact.companies.length,
        competitors: competitorCount,
        flag,
        dryRun,
      },
      null,
      2
    )
  );

  if (dryRun) {
    console.log('[company-universe:sync] dry run only; not applying SQL to D1');
    return;
  }

  const proc = spawn(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'high-signal-db',
      flag,
      `--file=${TMP_SQL}`,
      '--config=workers/api/wrangler.toml',
    ],
    { stdio: 'inherit', cwd: __root }
  );
  proc.on('close', (code) => process.exit(code ?? 0));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
