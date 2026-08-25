import { describe, expect, it, vi } from 'vitest';
import app from '../index';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

function mockDb(retainDocuments = true) {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const database = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          if (sql.includes('source_documents')) {
            return { results: retainDocuments ? [{ id: 'retained-document' }] : [] };
          }
          return { results: [] };
        },
        async raw() {
          if (sql.includes('source_documents')) {
            return retainDocuments ? [['retained-document']] : [];
          }
          if (sql.includes('returning "id"')) return [['NVDA']];
          return [];
        },
      };
      statements.push(statement);
      return statement;
    }),
    statements,
  };
  return database;
}

function proofSignal() {
  return {
    slug: 'nvda-capacity-expansion',
    signalType: 'capacity_change',
    primaryEntityId: 'NVDA',
    direction: 'up',
    confidence: 'high',
    predictedWindowDays: 30,
    publishedAt: '2026-08-26T00:00:00.000Z',
    evidenceUrls: ['https://one.example/a', 'https://two.example/b'],
    evidence: [
      {
        url: 'https://one.example/a',
        sourceDocumentKey: 'news:one:https://one.example/a',
        originatingEvidenceId: 'announcement-1',
        semanticAlignment: 'verified',
        role: 'primary',
        supports: ['observed_event'],
      },
      {
        url: 'https://two.example/b',
        sourceDocumentKey: 'filing:https://two.example/b',
        originatingEvidenceId: 'filing-2',
        semanticAlignment: 'verified',
        role: 'corroboration',
        supports: ['observed_event', 'direct_entity_impact'],
      },
    ],
    spilloverEntityIds: [],
    reviewStatus: 'draft',
    bodyMd: '## What changed\nCapacity expanded.\n\n## Why it matters\nSupply increased.',
    observedEvent: 'NVIDIA expanded accelerator capacity.',
    directEntityImpact: 'More sellable capacity.',
    claim: {
      assertion: 'NVIDIA expanded accelerator capacity.',
      event: 'capacity expansion',
      amount: '20 percent',
      date: '2026-08-26',
      direction: 'up',
    },
  };
}

async function sync(database: ReturnType<typeof mockDb>) {
  return fetcher.fetch(
    new Request('http://t/admin/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ signals: [proofSignal()] }),
    }),
    { DB: database as unknown as D1Database, ADMIN_TOKEN: 'secret' }
  );
}

describe('POST /admin/sync proof receipts', () => {
  it('persists the normalized claim and verified retained-document links', async () => {
    const database = mockDb();
    const response = await sync(database);
    const body = (await response.json()) as { upserts: number; proofUpserts: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ upserts: 1, proofUpserts: 1 });
    expect(database.statements.some((statement) => statement.sql.includes('claim_records'))).toBe(
      true
    );
    const links = database.statements.filter((statement) =>
      statement.sql.includes('claim_evidence_links')
    );
    expect(links).toHaveLength(2);
    expect(links[0]?.args).toContain('retained-document');
    expect(links[0]?.args).toContain('verified');
    expect(links[0]?.args).toContain('primary');
    expect(links[1]?.args).toContain('corroboration');
  });

  it('does not grant verified alignment when the source document is absent', async () => {
    const database = mockDb(false);
    const response = await sync(database);
    expect(response.status).toBe(200);
    const links = database.statements.filter((statement) =>
      statement.sql.includes('claim_evidence_links')
    );
    expect(links).toHaveLength(2);
    expect(links.every((statement) => statement.args.includes('unverified'))).toBe(true);
    expect(links.every((statement) => !statement.args.includes('verified'))).toBe(true);
  });
});
