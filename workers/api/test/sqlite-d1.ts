/// <reference path="./node-builtins.d.ts" />
/**
 * A `D1Database`-shaped adapter over Node's built-in SQLite.
 *
 * The rest of the suite mocks D1 by SQL fingerprint, which is fine for shaping
 * a response but cannot answer "does the rewritten query return the same
 * numbers as the one it replaced?". That question needs a real query planner
 * and real SQL semantics (`GLOB`, `LIKE`, `unixepoch()`, aggregate NULL
 * rules), so those tests run the actual statements against a real database.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

type Row = Record<string, unknown>;

function toBindable(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return value as string | number | bigint | null;
}

function normalize(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out;
}

class Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: readonly unknown[] = []
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.database, this.sql, params);
  }

  private rows(): Row[] {
    const prepared = this.database.prepare(this.sql);
    return (prepared.all(...(this.params.map(toBindable) as never[])) as Row[]).map(normalize);
  }

  all() {
    const results = this.rows();
    return Promise.resolve({
      success: true,
      results,
      meta: { rows_read: results.length, rows_written: 0 },
    });
  }

  raw() {
    return Promise.resolve(this.rows().map((row) => Object.values(row)));
  }

  first(column?: string) {
    const [row] = this.rows();
    if (!row) return Promise.resolve(null);
    return Promise.resolve(column ? (row[column] ?? null) : row);
  }

  run() {
    const prepared = this.database.prepare(this.sql);
    const result = prepared.run(...(this.params.map(toBindable) as never[]));
    return Promise.resolve({
      success: true,
      results: [],
      meta: { rows_read: 0, rows_written: Number(result.changes ?? 0) },
    });
  }
}

export interface TestD1 {
  binding: D1Database;
  exec(sql: string): void;
  close(): void;
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/db/migrations');

/**
 * Applies the real migration directory, in order, so a test database is built
 * by exactly the statements production runs — including the migration under
 * test stacking on top of the twenty-five before it.
 */
export function applyMigrations(d1: TestD1) {
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) d1.exec(statement);
    }
  }
}

export function createSqliteD1(): TestD1 {
  const database = new DatabaseSync(':memory:');
  const binding = {
    prepare: (sql: string) => new Statement(database, sql),
    batch: async (statements: Statement[]) => {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return {
    binding,
    exec: (sql: string) => database.exec(sql),
    close: () => database.close(),
  };
}
