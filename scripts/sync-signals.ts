#!/usr/bin/env tsx
/**
 * Sync `signals/YYYY-MM-DD/*.md` (the git-versioned source of truth) into D1.
 *
 *   pnpm tsx scripts/sync-signals.ts --local
 *   pnpm tsx scripts/sync-signals.ts --remote
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from './sync-signals.lib';
import { buildSignalSql } from './sync-signals.sql';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIGNALS_ROOT = resolve(__root, 'signals');
const TMP_DIR = resolve(__root, '.tmp');
const TMP_SQL = resolve(TMP_DIR, 'signals-sync.sql');
const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const CACHE_FILE = resolve(TMP_DIR, `signals-sync-cache-${flag.slice(2)}.json`);
const FORCE = process.argv.includes('--force');

type HashCache = Record<string, string>;

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function loadCache(): HashCache {
  if (FORCE || !existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as HashCache;
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
    else if (f.endsWith('.md') && f !== 'README.md') out.push(p);
  }
  return out;
}

function run() {
  const files = walk(SIGNALS_ROOT);
  const cache = loadCache();
  const nextCache: HashCache = {};
  console.log(`[sync] ${files.length} signal files${FORCE ? ' (force)' : ''}`);

  const sql: string[] = [];
  let skipped = 0;
  let written = 0;
  for (const fp of files) {
    const md = readFileSync(fp, 'utf-8');
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(md);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] skip ${fp}: ${reason}`);
      continue;
    }
    const f = parsed.front;
    const id = hash16(f.slug);
    const contentHash = createHash('sha256').update(md).digest('hex');
    nextCache[id] = contentHash;
    if (cache[id] === contentHash) {
      skipped += 1;
      continue;
    }
    written += 1;
    sql.push(...buildSignalSql(f, parsed.body));
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join('\n') + '\n');
  console.log(
    `[sync] wrote ${TMP_SQL} (${sql.length} statements; ${written} changed, ${skipped} unchanged)`
  );

  if (sql.length === 0) {
    console.log('[sync] nothing to apply');
    saveCache(nextCache);
    return;
  }
  const proc = spawn(
    'wrangler',
    [
      'd1',
      'execute',
      'high-signal-db',
      flag,
      `--file=${TMP_SQL}`,
      '--config=workers/api/wrangler.toml',
    ],
    { stdio: 'inherit', cwd: __root }
  );
  proc.on('close', (code) => {
    if (code === 0) saveCache(nextCache);
    process.exit(code ?? 0);
  });
}

run();
