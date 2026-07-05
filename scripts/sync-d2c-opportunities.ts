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

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { escSql as esc } from "./sync-signals.lib";
import {
  buildSnapshotRecord,
  D2C_NICHE_SEEDS,
  loadLatestD2CArtifact,
} from "@high-signal/shared";

const __root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIR = resolve(__root, "data/d2c-opportunities");
const TMP_DIR = resolve(__root, ".tmp");
const TMP_SQL = resolve(TMP_DIR, "d2c-opportunities-sync.sql");
const flag = process.argv.includes("--remote") ? "--remote" : "--local";

// Node fs impl for `loadLatestD2CArtifact`.
const fsImpl = {
  readdir: async (p: string) => readdirSync(p),
  readFile: async (p: string) => readFileSync(p, "utf-8"),
};

function nicheId(slug: string): string {
  return createHash("sha256").update(`d2c-niche:${slug}`).digest("hex").slice(0, 16);
}

function snapshotId(nicheId: string, date: string): string {
  return createHash("sha256").update(`d2c-snap:${nicheId}:${date}`).digest("hex").slice(0, 16);
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
    console.log("[d2c:sync] no artifact found; nothing to sync");
    process.exit(0);
  }
  const snapshotDate = artifact.generatedAt.slice(0, 10);
  const snapshotMs = isoDateToEpochMs(artifact.generatedAt);
  console.log(`[d2c:sync] artifact ${snapshotDate}; ${artifact.niches.length} niches`);

  const sql: string[] = [];
  // 1. Upsert all 20 niche rows (stable, slug-keyed). Even niches with no
  //    evidence in this artifact get a row so the renderer can list them.
  for (const seed of D2C_NICHE_SEEDS) {
    const id = nicheId(seed.slug);
    sql.push(
      `INSERT INTO d2c_niches (id, slug, name, category, region, status, created_at, updated_at) ` +
        `VALUES (${esc(id)}, ${esc(seed.slug)}, ${esc(seed.name)}, ${esc(seed.category)}, ${esc(seed.region)}, 'active', ${snapshotMs}, ${snapshotMs}) ` +
        `ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, updated_at=excluded.updated_at;`,
    );
  }
  // 2. Insert one snapshot row per niche (replace on conflict for the same
  //    niche + date so re-running is idempotent).
  for (const seed of D2C_NICHE_SEEDS) {
    const id = nicheId(seed.slug);
    const evidence = artifact.niches.find((n) => n.nicheSlug === seed.slug) ?? null;
    const record = buildSnapshotRecord(seed, evidence, snapshotDate);
    const snapId = snapshotId(id, snapshotDate);
    const evidenceJson = JSON.stringify(evidence?.evidence ?? []);
    sql.push(
      `INSERT INTO d2c_niche_snapshots ` +
        `(id, niche_id, snapshot_date, opportunity_score, demand_score, competition_score, pricing_score, ad_saturation_score, agent_visibility_score, source_diversity, verdict, confidence, evidence_json, freshness_date, notes, created_at) ` +
        `VALUES (${esc(snapId)}, ${esc(id)}, ${snapshotMs}, ${record.opportunityScore}, ` +
        `${record.demandScore == null ? "NULL" : record.demandScore}, ` +
        `${record.competitionScore == null ? "NULL" : record.competitionScore}, ` +
        `${record.pricingScore == null ? "NULL" : record.pricingScore}, ` +
        `${record.adSaturationScore == null ? "NULL" : record.adSaturationScore}, ` +
        `${record.agentVisibilityScore == null ? "NULL" : record.agentVisibilityScore}, ` +
        `${record.sourceDiversity}, ${esc(record.verdict)}, ${esc(record.confidence)}, ` +
        `${esc(evidenceJson)}, ${esc(record.freshnessDate)}, ${esc(evidence?.notes ?? null)}, ${snapshotMs}) ` +
        `ON CONFLICT(niche_id, snapshot_date) DO UPDATE SET ` +
        `opportunity_score=excluded.opportunity_score, demand_score=excluded.demand_score, ` +
        `competition_score=excluded.competition_score, pricing_score=excluded.pricing_score, ` +
        `ad_saturation_score=excluded.ad_saturation_score, agent_visibility_score=excluded.agent_visibility_score, ` +
        `source_diversity=excluded.source_diversity, verdict=excluded.verdict, confidence=excluded.confidence, ` +
        `evidence_json=excluded.evidence_json, freshness_date=excluded.freshness_date, notes=excluded.notes;`,
    );
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join("\n") + "\n");
  console.log(`[d2c:sync] wrote ${TMP_SQL} (${sql.length} statements)`);

  const proc = spawn(
    "wrangler",
    ["d1", "execute", "high-signal-db", flag, `--file=${TMP_SQL}`, "--config=workers/api/wrangler.toml"],
    { stdio: "inherit", cwd: __root },
  );
  proc.on("close", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
