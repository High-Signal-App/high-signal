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
const MAX_ADDITIVE_ENTITIES = 25;

export function parseCsv(s: string): Array<Record<string, string>> {
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

export function addEntitiesSql(rows: Array<Record<string, string>>): string {
  if (rows.length === 0 || rows.length > MAX_ADDITIVE_ENTITIES) {
    throw new Error(`additive entity seed accepts 1-${MAX_ADDITIVE_ENTITIES} rows`);
  }
  const ids = rows.map((row) => row.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error('additive entity seed requires unique, non-empty ids');
  }

  const now = Math.floor(Date.now() / 1000);
  const values = rows.map((r) => {
    const metadata = JSON.stringify({
      subsector: r.subsector || null,
      aliases: (r.aliases || '').split('|').filter(Boolean),
      wiki_url: r.wiki_url || null,
      ir_url: r.ir_url || null,
    });
    return `(${esc(r.id)},${esc(r.ticker)},${esc(r.name)},${esc(r.type || 'public')},${esc(r.country)},${esc(r.sector)},${esc(metadata)},${now},${now})`;
  });
  const sameIdentity = ['ticker', 'name', 'type', 'country', 'sector', 'metadata']
    .map((column) => `entities.${column} IS excluded.${column}`)
    .join(' AND ');

  // One atomic multi-row statement adds missing IDs, preserves exact existing
  // identities, and deliberately violates the id NOT NULL constraint on any
  // same-ID/different-identity conflict. It cannot replace unrelated rows.
  return `INSERT INTO entities (id,ticker,name,type,country,sector,metadata,created_at,updated_at) VALUES ${values.join(',')} ON CONFLICT(id) DO UPDATE SET id = CASE WHEN ${sameIdentity} THEN entities.id ELSE NULL END;`;
}

export function assertNoRosterIdentityCollisions(
  rows: Array<Record<string, string>>,
  roster: Array<Record<string, string>>
): void {
  const selectedIds = new Set(rows.map((row) => row.id));
  const owners = new Map<string, string>();
  for (const row of rows) {
    const terms = [row.id, row.ticker, row.name, ...(row.aliases || '').split('|')]
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    for (const term of terms) {
      const previous = owners.get(term);
      if (previous && previous !== row.id) {
        throw new Error(
          `additive entity identity collision: ${term} maps to ${previous} and ${row.id}`
        );
      }
      owners.set(term, row.id);
    }
  }
  for (const existing of roster) {
    if (selectedIds.has(existing.id)) continue;
    const terms = [
      existing.id,
      existing.ticker,
      existing.name,
      ...(existing.aliases || '').split('|'),
    ]
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    for (const term of terms) {
      const selected = owners.get(term);
      if (selected) {
        throw new Error(
          `additive entity identity collision: ${term} already belongs to ${existing.id}`
        );
      }
    }
  }
}

export function wranglerSeedArgs(
  databaseMode: string,
  sqlFile: string,
  configFile: string
): string[] {
  return [
    '--filter',
    '@high-signal/api',
    'exec',
    'wrangler',
    'd1',
    'execute',
    'high-signal-db',
    databaseMode,
    `--file=${sqlFile}`,
    `--config=${configFile}`,
  ];
}

export function requestedAddIds(args: string[]): string[] | null {
  const indexes = args.flatMap((arg, index) =>
    arg === '--add-entities' || arg.startsWith('--add-entities=') ? [index] : []
  );
  if (indexes.length === 0) return null;
  if (indexes.length > 1) throw new Error('--add-entities may only be specified once');
  const flagIndex = indexes[0];
  const value =
    args[flagIndex] === '--add-entities'
      ? args[flagIndex + 1]
      : args[flagIndex].slice('--add-entities='.length);
  const ids = (value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_ADDITIVE_ENTITIES || new Set(ids).size !== ids.length) {
    throw new Error(
      `--add-entities requires 1-${MAX_ADDITIVE_ENTITIES} unique comma-separated entity IDs`
    );
  }
  return ids;
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

  const addIds = requestedAddIds(process.argv.slice(2));
  const eSql = addIds
    ? (() => {
        const rows = addIds.map((id) => {
          const matches = entities.filter((entity) => entity.id === id);
          if (matches.length !== 1) {
            throw new Error(
              `expected one CSV row for additive entity ${id}, found ${matches.length}`
            );
          }
          return matches[0];
        });
        assertNoRosterIdentityCollisions(rows, entities);
        return [addEntitiesSql(rows)];
      })()
    : entitiesSql(entities);
  const { sql: rSql, skipped } = addIds ? { sql: [], skipped: 0 } : relsSql(rels, validIds);

  console.log(`[seed] entities: ${eSql.length}`);
  console.log(`[seed] relationships: ${rSql.length} (skipped ${skipped} with missing FK)`);

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, [...eSql, ...rSql].join('\n') + '\n');
  console.log(`[seed] wrote ${TMP_SQL}`);

  const cmd = 'pnpm';
  const args = wranglerSeedArgs(flag, TMP_SQL, resolve(__root, 'workers/api/wrangler.toml'));
  console.log(`[seed] running: ${cmd} ${args.join(' ')}`);
  const proc = spawn(cmd, args, { stdio: 'inherit', cwd: __root });
  proc.on('close', (code) => process.exit(code ?? 1));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run();
}
