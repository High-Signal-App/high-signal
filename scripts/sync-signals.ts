#!/usr/bin/env tsx
/**
 * Sync `signals/YYYY-MM-DD/*.md` (the git-versioned source of truth) into D1.
 *
 *   pnpm tsx scripts/sync-signals.ts --local
 *   pnpm tsx scripts/sync-signals.ts --remote
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { escSql as esc, parseFrontmatter } from "./sync-signals.lib";

const __root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS_ROOT = resolve(__root, "signals");
const TMP_DIR = resolve(__root, ".tmp");
const TMP_SQL = resolve(TMP_DIR, "signals-sync.sql");
const flag = process.argv.includes("--remote") ? "--remote" : "--local";
const CACHE_FILE = resolve(TMP_DIR, `signals-sync-cache-${flag.slice(2)}.json`);
const FORCE = process.argv.includes("--force");

type HashCache = Record<string, string>;

function loadCache(): HashCache {
  if (FORCE || !existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as HashCache;
  } catch {
    return {};
  }
}

function saveCache(cache: HashCache): void {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (f.endsWith(".md") && f !== "README.md") out.push(p);
  }
  return out;
}

function run() {
  const files = walk(SIGNALS_ROOT);
  const cache = loadCache();
  const nextCache: HashCache = {};
  console.log(`[sync] ${files.length} signal files${FORCE ? " (force)" : ""}`);

  const sql: string[] = [];
  let skipped = 0;
  let written = 0;
  for (const fp of files) {
    const md = readFileSync(fp, "utf-8");
    let parsed;
    try {
      parsed = parseFrontmatter(md);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] skip ${fp}: ${reason}`);
      continue;
    }
    const f = parsed.front;
    const body = parsed.body;
    const id = createHash("sha256").update(f.slug).digest("hex").slice(0, 16);
    const contentHash = createHash("sha256").update(md).digest("hex");
    nextCache[id] = contentHash;
    if (cache[id] === contentHash) {
      skipped += 1;
      continue;
    }
    written += 1;
    const publishedAt = Math.floor(new Date(f.published_at).getTime() / 1000);

    sql.push(
      `INSERT OR REPLACE INTO signals (id,slug,signal_type,primary_entity_id,direction,confidence,predicted_window_days,published_at,evidence_urls,spillover_entity_ids,review_status,supersedes_signal_id,body_md) VALUES (${esc(id)},${esc(f.slug)},${esc(f.signal_type)},${esc(f.primary_entity)},${esc(f.direction)},${esc(f.confidence)},${f.predicted_window_days},${publishedAt},${esc(JSON.stringify(f.evidence_urls))},${esc(JSON.stringify(f.spillover_entity_ids ?? []))},${esc(f.review_status)},${esc(f.supersedes ?? null)},${esc(body)});`,
    );
    sql.push(`DELETE FROM evidence WHERE signal_id = ${esc(id)};`);
    for (const [index, url] of f.evidence_urls.entries()) {
      const eid = createHash("sha256").update(`${id}:${url}`).digest("hex").slice(0, 16);
      const publishedAtRaw = f.evidence_published_at?.[index];
      const evidencePublishedAt =
        publishedAtRaw && Number.isFinite(new Date(publishedAtRaw).getTime())
          ? Math.floor(new Date(publishedAtRaw).getTime() / 1000)
          : null;
      sql.push(
        `INSERT INTO evidence (id,signal_id,url,source_type,excerpt,published_at) VALUES (${esc(eid)},${esc(id)},${esc(url)},${esc(f.evidence_source_types?.[index] ?? "web")},${esc(f.evidence_quotes?.[index] || null)},${evidencePublishedAt ?? "NULL"});`,
      );
    }
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join("\n") + "\n");
  console.log(
    `[sync] wrote ${TMP_SQL} (${sql.length} statements; ${written} changed, ${skipped} unchanged)`,
  );

  if (sql.length === 0) {
    console.log("[sync] nothing to apply");
    saveCache(nextCache);
    return;
  }
  const proc = spawn(
    "wrangler",
    ["d1", "execute", "high-signal-db", flag, `--file=${TMP_SQL}`, "--config=workers/api/wrangler.toml"],
    { stdio: "inherit", cwd: __root },
  );
  proc.on("close", (code) => {
    if (code === 0) saveCache(nextCache);
    process.exit(code ?? 0);
  });
}

run();
