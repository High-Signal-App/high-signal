#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { buildPublicCorpusCandidates } from '../apps/web/public-corpus-records.mjs';
import {
  assertPublicCorpusReceipt,
  buildPublicCorpusReceipt,
} from '../apps/web/public-corpus-receipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = resolve(root, 'apps/web/src/data/company-universe-web.json');
const receiptPath = resolve(root, 'apps/web/src/data/public-corpus-receipt.json');
const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'https://api.highsignal.app';
const accept = process.argv.includes('--accept');

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function fetchJson(path) {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) throw new Error(`Public corpus source failed: ${path} (${response.status})`);
  return response.json();
}

const [artifact, signalsPayload, entitiesPayload, briefDatesPayload, previous] = await Promise.all([
  readJson(artifactPath),
  fetchJson('/signals?limit=5000'),
  fetchJson('/entities'),
  fetchJson('/brief/dates'),
  readJson(receiptPath),
]);

const candidates = buildPublicCorpusCandidates({
  companies: artifact.companies,
  companyLastModified:
    artifact.similarityMapping?.generatedAt ??
    artifact.entityExtraction?.generatedAt ??
    artifact.generatedAt,
  signals: signalsPayload.signals,
  entities: entitiesPayload.entities,
  briefDates: briefDatesPayload.dates,
  directoryPageCount: Math.ceil(artifact.companies.length / 50),
});
const receipt = buildPublicCorpusReceipt(candidates, previous);
assertPublicCorpusReceipt(receipt, { previous });

if (accept) {
  const temporary = `${receiptPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(temporary, receiptPath);
  const formatted = spawnSync(
    resolve(root, 'node_modules/.bin/biome'),
    ['format', '--write', receiptPath],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
  if (formatted.status !== 0) {
    throw new Error(`Receipt formatting failed: ${formatted.stderr || formatted.stdout}`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    accepted: accept,
    path: receiptPath,
    policyRevision: receipt.policyRevision,
    totals: receipt.totals,
    families: Object.fromEntries(
      Object.entries(receipt.families).map(([family, row]) => [
        family,
        { total: row.total, eligible: row.eligible, withheld: row.withheld },
      ])
    ),
    added: receipt.addedUrls.length,
    removed: receipt.removedUrls.length,
  })}\n`
);
