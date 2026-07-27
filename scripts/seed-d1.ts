#!/usr/bin/env tsx
/**
 * Seed D1 from CSV — entities + relationships.
 *
 * Run after `wrangler d1 create high-signal-db` + applying 0000_init migration:
 *   pnpm tsx scripts/seed-d1.ts --local
 *   pnpm tsx scripts/seed-d1.ts --remote
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTITIES_CSV = resolve(
  __root,
  'python/ingest/src/high_signal_ingest/seed/ai_infra_entities.csv'
);
const RELS_CSV = resolve(__root, 'python/ingest/src/high_signal_ingest/seed/relationships.csv');
const TMP_DIR = resolve(__root, '.tmp');
const TMP_SQL = resolve(TMP_DIR, 'seed.sql');

const flag = process.argv.includes('--remote') ? '--remote' : '--local';

function parseCsv(s: string): Array<Record<string, string>> {
  const lines = s.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const parts = splitCsvLine(l);
    const row: Record<string, string> = {};
    header.forEach((k, i) => {
      row[k] = parts[i] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"' && inQ) {
      cur += '"';
      i++;
    } else if (c === '"') {
      inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function esc(s: string | null | undefined): string {
  if (s == null || s === '') return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function entitiesSql(rows: Array<Record<string, string>>): string[] {
  const now = Math.floor(Date.now() / 1000);
  return rows.map((r) => {
    return `INSERT OR REPLACE INTO entities (id,ticker,name,type,country,sector,metadata,created_at,updated_at) VALUES (${esc(r.id)},${esc(r.ticker)},${esc(r.name)},${esc(r.type || 'public')},${esc(r.country)},${esc(r.sector)},${esc(JSON.stringify({ subsector: r.subsector || null, aliases: (r.aliases || '').split('|').filter(Boolean), wiki_url: r.wiki_url || null, ir_url: r.ir_url || null }))},${now},${now});`;
  });
}

function relsSql(
  rows: Array<Record<string, string>>,
  validIds: Set<string>
): {
  sql: string[];
  skipped: number;
} {
  const now = Math.floor(Date.now() / 1000);
  let skipped = 0;
  const sql: string[] = [];
  for (const r of rows) {
    if (!validIds.has(r.from_entity_id) || !validIds.has(r.to_entity_id)) {
      skipped++;
      continue;
    }
    const id = `${r.from_entity_id}-${r.to_entity_id}-${r.type}`;
    sql.push(
      `INSERT OR IGNORE INTO relationships (id,from_entity_id,to_entity_id,type,weight,verified,evidence_url,created_at) VALUES (${esc(id)},${esc(r.from_entity_id)},${esc(r.to_entity_id)},${esc(r.type)},${r.weight || 1.0},1,${esc(r.evidence_url)},${now});`
    );
  }
  return { sql, skipped };
}

function run() {
  console.log(`[seed] reading ${ENTITIES_CSV}`);
  const entities = parseCsv(readFileSync(ENTITIES_CSV, 'utf-8'));
  console.log(`[seed] reading ${RELS_CSV}`);
  const rels = parseCsv(readFileSync(RELS_CSV, 'utf-8'));
  const validIds = new Set(entities.map((e) => e.id));

  const eSql = entitiesSql(entities);
  const { sql: rSql, skipped } = relsSql(rels, validIds);

  console.log(`[seed] entities: ${eSql.length}`);
  console.log(`[seed] relationships: ${rSql.length} (skipped ${skipped} with missing FK)`);

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, [...eSql, ...rSql].join('\n') + '\n');
  console.log(`[seed] wrote ${TMP_SQL}`);

  const cmd = 'wrangler';
  const args = [
    'd1',
    'execute',
    'high-signal-db',
    flag,
    `--file=${TMP_SQL}`,
    '--config=workers/api/wrangler.toml',
  ];
  console.log(`[seed] running: ${cmd} ${args.join(' ')}`);
  const proc = spawn(cmd, args, { stdio: 'inherit', cwd: __root });
  proc.on('close', (code) => process.exit(code ?? 0));
}

run();
