import { describe, expect, it, vi } from 'vitest';
import app from '../index';

const fetcher = app as unknown as {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
};

function database(lookupFails = false, existingDocumentId?: string) {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  let lookups = 0;
  return {
    writes,
    get lookups() {
      return lookups;
    },
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async raw() {
          if (sql.startsWith('insert into "source_documents"')) {
            writes.push({ sql, args });
            return [[existingDocumentId ?? args[0]]];
          }
          lookups++;
          if (lookupFails) throw new Error('lookup unavailable');
          return args[0] === 'NVDA' ? [['NVDA']] : [];
        },
        async run() {
          writes.push({ sql, args });
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

async function ingest(db: ReturnType<typeof database>, ids: Array<string | null>) {
  return fetcher.fetch(
    new Request('http://t/admin/events', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: ids.map((id, index) => ({
          source: 'synthetic',
          sourceUrl: `https://example.com/${index}`,
          publishedAt: '2026-09-09T00:00:00Z',
          rawHash: `synthetic-${index}`,
          primaryEntityId: id,
          content: 'retained source evidence',
          sourceDocument: { parsedFields: { existing: 'preserved' } },
        })),
      }),
    }),
    { DB: db as unknown as D1Database, ADMIN_TOKEN: 'synthetic' }
  );
}

function eventField(row: { sql: string; args: unknown[] }, column: string) {
  const columns = row.sql
    .match(/\(([^)]+)\) values/)?.[1]
    .split(',')
    .map((s) => s.trim().replaceAll('"', ''));
  return row.args[columns?.indexOf(column) ?? -1];
}

describe('event entity persistence', () => {
  it('links a new event to the persisted document ID when an older key already exists', async () => {
    const db = database(false, 'legacy-document-id');
    const response = await ingest(db, ['NVDA']);
    expect(await response.json()).toEqual({ inserted: 1 });
    const event = db.writes.find((row) => row.sql.startsWith('insert into "events"'));
    expect(eventField(event!, 'source_document_id')).toBe('legacy-document-id');
  });

  it('retains unknown identifiers as metadata without assigning a nonexistent entity', async () => {
    const db = database();
    const response = await ingest(db, ['UNKNOWN', 'NVDA', null, 'UNKNOWN']);
    expect(await response.json()).toEqual({ inserted: 4 });
    expect(db.lookups).toBe(2);
    const events = db.writes.filter((row) => row.sql.startsWith('insert into "events"'));
    expect(events.map((row) => eventField(row, 'primary_entity_id'))).toEqual([
      null,
      'NVDA',
      null,
      null,
    ]);
    const docs = db.writes.filter((row) => row.sql.startsWith('insert into "source_documents"'));
    expect(docs[0].args).toContain(
      JSON.stringify({ existing: 'preserved', unresolvedPrimaryEntityId: 'UNKNOWN' })
    );
    expect(docs[0].args).toContain('retained source evidence');
    expect(db.writes.every((row) => !row.sql.startsWith('insert into "entities"'))).toBe(true);
  });

  it('does not reinterpret a lookup outage as an unknown entity', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const db = database(true);
      const response = await ingest(db, ['NVDA']);
      expect(await response.json()).toEqual({ inserted: 0 });
      expect(db.writes).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});
