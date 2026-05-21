#!/usr/bin/env tsx
/**
 * Seed product-flow evidence into existing Community Intelligence tables.
 *
 *   pnpm tsx scripts/seed-product-flow.ts --local
 *   pnpm tsx scripts/seed-product-flow.ts --remote
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_JSON = resolve(__root, "data/product-flow-seed.json");
const TMP_DIR = resolve(__root, ".tmp");
const TMP_SQL = resolve(TMP_DIR, "product-flow-seed.sql");
const flag = process.argv.includes("--remote") ? "--remote" : "--local";

interface SeedDigest {
  snapshotDate: string;
  sourceCount: number;
  summaryText: string;
  summary: unknown;
}

interface SeedCommunity {
  subreddit: string;
  period: "day" | "week" | "month";
  prompt: string;
  digests: SeedDigest[];
}

interface SeedFile {
  ownerId: string;
  communities: SeedCommunity[];
}

function esc(s: string | null | undefined): string {
  if (s == null || s === "") return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function idFor(...parts: string[]) {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 16);
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unixSeconds(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function run() {
  const seed = JSON.parse(readFileSync(SEED_JSON, "utf-8")) as SeedFile;
  const now = Math.floor(Date.now() / 1000);
  const sql: string[] = [];

  for (const community of seed.communities) {
    const communityId = `seed-${slug(community.subreddit)}-${community.period}`;
    sql.push(
      `INSERT OR REPLACE INTO tracked_communities (id,owner_id,subreddit,prompt,period,is_public,created_at,updated_at) VALUES (${esc(communityId)},${esc(seed.ownerId)},${esc(community.subreddit)},${esc(community.prompt)},${esc(community.period)},1,${now},${now});`,
    );

    for (const digest of community.digests) {
      const digestId = idFor("product-flow", communityId, digest.snapshotDate);
      const snapshotDate = unixSeconds(digest.snapshotDate);
      sql.push(
        `INSERT OR REPLACE INTO community_digest_snapshots (id,tracked_community_id,owner_id,subreddit,period,snapshot_date,summary_text,summary,prompt_used,source_count,created_at) VALUES (${esc(digestId)},${esc(communityId)},${esc(seed.ownerId)},${esc(community.subreddit)},${esc(community.period)},${snapshotDate},${esc(digest.summaryText)},${esc(JSON.stringify(digest.summary))},${esc(community.prompt)},${Math.max(0, Math.floor(digest.sourceCount))},${now});`,
      );
    }
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join("\n") + "\n");
  console.log(`[seed-product-flow] wrote ${TMP_SQL} (${sql.length} statements)`);

  const proc = spawn(
    "pnpm",
    [
      "--dir",
      "packages/db",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "high-signal-db",
      flag,
      `--file=${TMP_SQL}`,
      "--config=../../workers/api/wrangler.toml",
    ],
    { stdio: "inherit", cwd: __root },
  );
  proc.on("close", (code) => process.exit(code ?? 0));
}

run();
