#!/usr/bin/env tsx
/**
 * Sync the latest `data/d2c-agent-visibility/<YYYY-MM-DD>.json` artifact into
 * D1 (plan 0013, Slice 4). Idempotent: re-running for the same date replaces
 * the entries for that run_date.
 *
 *   pnpm tsx scripts/sync-d2c-agent-visibility.ts --local
 *   pnpm tsx scripts/sync-d2c-agent-visibility.ts --remote
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { escSql as esc } from './sync-signals.lib';
import { runPinnedD1Execute } from './run-pinned-d1';
import { postAdminJson } from './admin-api';
import { D2C_NICHE_SEEDS, type D2CAgentVisibilityArtifact } from '@high-signal/shared';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = resolve(__root, 'data/d2c-agent-visibility');
const TMP_DIR = resolve(__root, '.tmp');
const TMP_SQL = resolve(TMP_DIR, 'd2c-agent-visibility-sync.sql');
const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const apiSync = process.argv.includes('--api');

function nicheId(slug: string): string {
  return createHash('sha256').update(`d2c-niche:${slug}`).digest('hex').slice(0, 16);
}

function entryId(nicheId: string, platform: string, runMs: number): string {
  return createHash('sha256')
    .update(`d2c-av:${nicheId}:${platform}:${runMs}`)
    .digest('hex')
    .slice(0, 16);
}

function isoDateToEpochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`unparseable ISO date: ${iso}`);
  return ms;
}

function loadLatestArtifact(): D2CAgentVisibilityArtifact | null {
  let names: string[];
  try {
    names = readdirSync(ARTIFACT_DIR);
  } catch {
    return null;
  }
  const dated = names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse();
  if (dated.length === 0) return null;
  try {
    return JSON.parse(
      readFileSync(`${ARTIFACT_DIR}/${dated[0]}`, 'utf-8')
    ) as D2CAgentVisibilityArtifact;
  } catch {
    return null;
  }
}

async function main() {
  const artifact = loadLatestArtifact();
  if (!artifact) {
    console.log('[d2c:sync-av] no artifact found; nothing to sync');
    process.exit(0);
  }
  const runMs = isoDateToEpochMs(artifact.generatedAt);
  console.log(
    `[d2c:sync-av] artifact ${artifact.generatedAt.slice(0, 10)}; ${artifact.entries.length} entries`
  );

  // Build a slug → nicheId lookup.
  const idBySlug = new Map<string, string>();
  for (const seed of D2C_NICHE_SEEDS) {
    idBySlug.set(seed.slug, nicheId(seed.slug));
  }

  const sql: string[] = [];
  const niches = D2C_NICHE_SEEDS.map((seed) => ({
    id: idBySlug.get(seed.slug)!,
    slug: seed.slug,
    name: seed.name,
    category: seed.category,
    region: seed.region,
    status: 'active',
    createdAt: runMs,
    updatedAt: runMs,
  }));
  const entries: Array<{
    id: string;
    nicheId: string;
    platform: string;
    model: string;
    promptText: string;
    responseText: string;
    recommendedBrands: string[];
    citedUrls: string[];
    brandMentioned: boolean;
    gapScore: number;
    runDate: number;
    createdAt: number;
  }> = [];
  // 1. Ensure all 20 niche rows exist (the sync-d2c-opportunities script
  //    also does this, but we can't assume it ran first).
  for (const seed of D2C_NICHE_SEEDS) {
    const id = idBySlug.get(seed.slug)!;
    sql.push(
      `INSERT INTO d2c_niches (id, slug, name, category, region, status, created_at, updated_at) ` +
        `VALUES (${esc(id)}, ${esc(seed.slug)}, ${esc(seed.name)}, ${esc(seed.category)}, ${esc(seed.region)}, 'active', ${runMs}, ${runMs}) ` +
        `ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, updated_at=excluded.updated_at;`
    );
  }
  // 2. Delete prior entries for this run_date (idempotent re-run).
  sql.push(`DELETE FROM d2c_agent_visibility WHERE run_date = ${runMs};`);
  // 3. Insert one row per entry.
  for (const entry of artifact.entries) {
    const nid = idBySlug.get(entry.nicheSlug);
    if (!nid) continue; // unknown niche slug — skip
    const id = entryId(nid, entry.platform, runMs);
    entries.push({
      id,
      nicheId: nid,
      platform: entry.platform,
      model: entry.model,
      promptText: entry.promptText,
      responseText: entry.responseText,
      recommendedBrands: entry.recommendedBrands,
      citedUrls: entry.citedUrls,
      brandMentioned: entry.brandMentioned,
      gapScore: entry.gapScore,
      runDate: runMs,
      createdAt: runMs,
    });
    sql.push(
      `INSERT OR REPLACE INTO d2c_agent_visibility ` +
        `(id, niche_id, platform, model, prompt_text, response_text, recommended_brands, cited_urls, brand_mentioned, gap_score, run_date, created_at) ` +
        `VALUES (${esc(id)}, ${esc(nid)}, ${esc(entry.platform)}, ${esc(entry.model)}, ` +
        `${esc(entry.promptText)}, ${esc(entry.responseText)}, ` +
        `${esc(JSON.stringify(entry.recommendedBrands))}, ${esc(JSON.stringify(entry.citedUrls))}, ` +
        `${entry.brandMentioned ? 1 : 0}, ${entry.gapScore}, ${runMs}, ${runMs});`
    );
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join('\n') + '\n');
  console.log(`[d2c:sync-av] wrote ${TMP_SQL} (${sql.length} statements)`);

  if (apiSync) {
    await postAdminJson(
      '/admin/scheduled-data/d2c-agent-visibility',
      { niches, runDate: runMs, entries },
      '[d2c:sync-av]'
    );
    return;
  }

  process.exit(
    await runPinnedD1Execute({
      projectRoot: __root,
      flag,
      sqlFile: TMP_SQL,
      logPrefix: '[d2c:sync-av]',
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
