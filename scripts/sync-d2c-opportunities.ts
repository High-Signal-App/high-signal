#!/usr/bin/env tsx
/**
 * Sync the latest `data/d2c-opportunities/<YYYY-MM-DD>.json` artifact into D1
 * (plan 0013, Slice 3). Idempotent: re-running for the same date upserts the
 * niche row and replaces the snapshot for that date.
 *
 *   pnpm tsx scripts/sync-d2c-opportunities.ts --local
 *   pnpm tsx scripts/sync-d2c-opportunities.ts --remote
 *
 * Reads the latest dated artifact, builds a snapshot record per niche using
 * `buildSnapshotRecord` (so the score/verdict/confidence match the renderer),
 * and inserts:
 *   - one `d2c_niches` row per niche (upsert by slug)
 *   - one `d2c_niche_snapshots` row per (niche, snapshot_date) — replace on conflict
 *
 * No external API calls; no impuls8 data; no paid sources. The artifact is
 * already cited — this script only persists it.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { escSql as esc } from './sync-signals.lib';
import { runPinnedD1Execute } from './run-pinned-d1';
import { postAdminJson } from './admin-api';
import {
  buildSnapshotRecord,
  D2C_NICHE_SEEDS,
  loadLatestD2CArtifact,
  loadLatestAgentVisibilityArtifact,
  type D2CEvidenceItem,
} from '@high-signal/shared';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = resolve(__root, 'data/d2c-opportunities');
const AV_ARTIFACT_DIR = resolve(__root, 'data/d2c-agent-visibility');
const TMP_DIR = resolve(__root, '.tmp');
const TMP_SQL = resolve(TMP_DIR, 'd2c-opportunities-sync.sql');
const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const apiSync = process.argv.includes('--api');

// Node fs impl for `loadLatestD2CArtifact`.
const fsImpl = {
  readdir: async (p: string) => readdirSync(p),
  readFile: async (p: string) => readFileSync(p, 'utf-8'),
};

function nicheId(slug: string): string {
  return createHash('sha256').update(`d2c-niche:${slug}`).digest('hex').slice(0, 16);
}

function snapshotId(nicheId: string, date: string): string {
  return createHash('sha256').update(`d2c-snap:${nicheId}:${date}`).digest('hex').slice(0, 16);
}

function isoDateToEpochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`unparseable ISO date: ${iso}`);
  }
  return ms;
}

async function main() {
  const artifact = await loadLatestD2CArtifact(ARTIFACT_DIR, fsImpl);
  if (!artifact) {
    console.log('[d2c:sync] no artifact found; nothing to sync');
    process.exit(0);
  }
  // Load the agent-visibility overlay (if it exists) so the snapshot's
  // agentVisibilityScore reflects the real AI gap, not a neutral default.
  const avArtifact = await loadLatestAgentVisibilityArtifact(AV_ARTIFACT_DIR, fsImpl);
  const avBySlug = new Map<string, number>();
  // Map from niche slug → product evidence items derived from the AV overlay.
  // The AI's cited URLs are real product/brand pages (supertails.com, etc.).
  // We extract them as sourceClass="product" evidence so source diversity
  // reflects the full evidence picture, not just the weekly collector.
  const avProductsBySlug = new Map<string, D2CEvidenceItem[]>();
  if (avArtifact) {
    for (const entry of avArtifact.entries) {
      const existing = avBySlug.get(entry.nicheSlug);
      if (existing == null || entry.gapScore > existing) {
        avBySlug.set(entry.nicheSlug, entry.gapScore);
      }
      // Create product evidence from the AV overlay's cited URLs.
      // Each URL is a real brand/product page that the AI surfaced.
      const products: D2CEvidenceItem[] = entry.citedUrls.slice(0, 3).map((url) => ({
        sourceClass: 'product' as const,
        url,
        source: 'agent-visibility:ai-cited',
        snippet: `Brand page cited by AI: ${entry.recommendedBrands.slice(0, 3).join(', ')}`,
        observedAt: entry.runDate,
      }));
      const existingProducts = avProductsBySlug.get(entry.nicheSlug) ?? [];
      avProductsBySlug.set(entry.nicheSlug, [...existingProducts, ...products]);
    }
    console.log(`[d2c:sync] agent-visibility overlay loaded; ${avArtifact.entries.length} entries`);
  } else {
    console.log('[d2c:sync] no agent-visibility overlay; using seed defaults');
  }
  const snapshotDate = artifact.generatedAt.slice(0, 10);
  const snapshotMs = isoDateToEpochMs(artifact.generatedAt);
  console.log(`[d2c:sync] artifact ${snapshotDate}; ${artifact.niches.length} niches`);

  const sql: string[] = [];
  const niches = D2C_NICHE_SEEDS.map((seed) => ({
    id: nicheId(seed.slug),
    slug: seed.slug,
    name: seed.name,
    category: seed.category,
    region: seed.region,
    status: 'active',
    createdAt: snapshotMs,
    updatedAt: snapshotMs,
  }));
  const snapshots: Array<{
    id: string;
    nicheId: string;
    snapshotDate: number;
    opportunityScore: number;
    demandScore: number | null;
    competitionScore: number | null;
    pricingScore: number | null;
    adSaturationScore: number | null;
    agentVisibilityScore: number | null;
    sourceDiversity: number;
    verdict: string;
    confidence: string;
    evidenceJson: D2CEvidenceItem[];
    freshnessDate: string;
    notes: string | null;
    createdAt: number;
  }> = [];
  // 1. Upsert all 20 niche rows (stable, slug-keyed). Even niches with no
  //    evidence in this artifact get a row so the renderer can list them.
  for (const seed of D2C_NICHE_SEEDS) {
    const id = nicheId(seed.slug);
    sql.push(
      `INSERT INTO d2c_niches (id, slug, name, category, region, status, created_at, updated_at) ` +
        `VALUES (${esc(id)}, ${esc(seed.slug)}, ${esc(seed.name)}, ${esc(seed.category)}, ${esc(seed.region)}, 'active', ${snapshotMs}, ${snapshotMs}) ` +
        `ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, updated_at=excluded.updated_at;`
    );
  }
  // 2. Insert one snapshot row per niche (replace on conflict for the same
  //    niche + date so re-running is idempotent).
  for (const seed of D2C_NICHE_SEEDS) {
    const id = nicheId(seed.slug);
    const evidence = artifact.niches.find((n) => n.nicheSlug === seed.slug) ?? null;
    const avGap = avBySlug.get(seed.slug) ?? null;
    // Merge the weekly collector's evidence with AV-derived product evidence.
    // The AV overlay's cited URLs are real product/brand pages that the AI
    // surfaced — they count as sourceClass="product" for source diversity.
    const weeklyEvidence = evidence?.evidence ?? [];
    const avProducts = avProductsBySlug.get(seed.slug) ?? [];
    // Dedupe by URL to avoid counting the same page twice.
    const seenUrls = new Set<string>();
    const mergedEvidence: D2CEvidenceItem[] = [];
    for (const item of [...weeklyEvidence, ...avProducts]) {
      if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        mergedEvidence.push(item);
      }
    }
    // Build a merged evidence object for buildSnapshotRecord.
    const mergedEvidenceObj = evidence
      ? { ...evidence, evidence: mergedEvidence }
      : mergedEvidence.length > 0
        ? { nicheSlug: seed.slug, evidence: mergedEvidence, freshnessDate: snapshotDate }
        : null;
    const record = buildSnapshotRecord(seed, mergedEvidenceObj, snapshotDate, avGap);
    const snapId = snapshotId(id, snapshotDate);
    const evidenceJson = JSON.stringify(mergedEvidence);
    snapshots.push({
      id: snapId,
      nicheId: id,
      snapshotDate: snapshotMs,
      opportunityScore: record.opportunityScore,
      demandScore: record.demandScore,
      competitionScore: record.competitionScore,
      pricingScore: record.pricingScore,
      adSaturationScore: record.adSaturationScore,
      agentVisibilityScore: record.agentVisibilityScore,
      sourceDiversity: record.sourceDiversity,
      verdict: record.verdict,
      confidence: record.confidence,
      evidenceJson: mergedEvidence,
      freshnessDate: record.freshnessDate,
      notes: evidence?.notes ?? null,
      createdAt: snapshotMs,
    });
    sql.push(
      `INSERT OR REPLACE INTO d2c_niche_snapshots ` +
        `(id, niche_id, snapshot_date, opportunity_score, demand_score, competition_score, pricing_score, ad_saturation_score, agent_visibility_score, source_diversity, verdict, confidence, evidence_json, freshness_date, notes, created_at) ` +
        `VALUES (${esc(snapId)}, ${esc(id)}, ${snapshotMs}, ${record.opportunityScore}, ` +
        `${record.demandScore == null ? 'NULL' : record.demandScore}, ` +
        `${record.competitionScore == null ? 'NULL' : record.competitionScore}, ` +
        `${record.pricingScore == null ? 'NULL' : record.pricingScore}, ` +
        `${record.adSaturationScore == null ? 'NULL' : record.adSaturationScore}, ` +
        `${record.agentVisibilityScore == null ? 'NULL' : record.agentVisibilityScore}, ` +
        `${record.sourceDiversity}, ${esc(record.verdict)}, ${esc(record.confidence)}, ` +
        `${esc(evidenceJson)}, ${esc(record.freshnessDate)}, ${esc(evidence?.notes ?? null)}, ${snapshotMs});`
    );
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join('\n') + '\n');
  console.log(`[d2c:sync] wrote ${TMP_SQL} (${sql.length} statements)`);

  if (apiSync) {
    await postAdminJson('/admin/scheduled-data/d2c-snapshots', { niches, snapshots }, '[d2c:sync]');
    return;
  }

  process.exit(
    await runPinnedD1Execute({
      projectRoot: __root,
      flag,
      sqlFile: TMP_SQL,
      logPrefix: '[d2c:sync]',
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
