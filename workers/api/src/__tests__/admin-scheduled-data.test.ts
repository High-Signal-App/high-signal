import { describe, expect, it, vi } from 'vitest';
import app from '../index';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

function mockDb() {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async all() {
          if (sql.includes('FROM events')) {
            return {
              results: [{ primary_entity_id: 'NVDA', source: 'sec', published_at: 1_700_000_000 }],
            };
          }
          if (sql.includes('FROM signals')) {
            return {
              results: [
                {
                  primary_entity_id: 'NVDA',
                  published_at: 1_700_000_100,
                  review_status: 'published',
                  signal_type: 'earnings',
                },
              ],
            };
          }
          return { results: [] };
        },
      };
      statements.push(statement);
      return statement;
    }),
    batch: vi.fn(async () => [{ success: true }]),
    statements,
  };
  return db;
}

function env(db: ReturnType<typeof mockDb>) {
  return { DB: db as unknown as D1Database, ENVIRONMENT: 'test', ADMIN_TOKEN: 'secret' };
}

const authorizedHeaders = {
  Authorization: 'Bearer secret',
  'Content-Type': 'application/json',
};

describe('admin scheduled data routes', () => {
  it('serves a bounded backtest dataset behind admin auth', async () => {
    const database = mockDb();
    const response = await fetcher.fetch(
      new Request('http://t/admin/scheduled-data/backtest?days=21', {
        headers: { Authorization: 'Bearer secret' },
      }),
      env(database)
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { days: number; events: unknown[]; signals: unknown[] };
    expect(body.days).toBe(21);
    expect(body.events).toHaveLength(1);
    expect(body.signals).toHaveLength(1);
    expect(database.prepare).toHaveBeenCalledTimes(2);
  });

  it('rejects an excessive backtest window', async () => {
    const response = await fetcher.fetch(
      new Request('http://t/admin/scheduled-data/backtest?days=365', {
        headers: { Authorization: 'Bearer secret' },
      }),
      env(mockDb())
    );
    expect(response.status).toBe(400);
  });

  it('rejects malformed scheduled writes before touching D1', async () => {
    const database = mockDb();
    const response = await fetcher.fetch(
      new Request('http://t/admin/scheduled-data/d2c-snapshots', {
        method: 'POST',
        headers: authorizedHeaders,
        body: JSON.stringify({ niches: [{ id: 'missing-fields' }], snapshots: [] }),
      }),
      env(database)
    );
    expect(response.status).toBe(400);
    expect(database.batch).not.toHaveBeenCalled();
  });

  it('persists D2C snapshots as one idempotent batch', async () => {
    const database = mockDb();
    const response = await fetcher.fetch(
      new Request('http://t/admin/scheduled-data/d2c-snapshots', {
        method: 'POST',
        headers: authorizedHeaders,
        body: JSON.stringify({
          niches: [
            {
              id: 'n1',
              slug: 'pet-care',
              name: 'Pet care',
              category: 'pets',
              region: 'south-asia',
              status: 'active',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          snapshots: [
            {
              id: 's1',
              nicheId: 'n1',
              snapshotDate: 1,
              opportunityScore: 60,
              demandScore: 0.7,
              competitionScore: 0.5,
              pricingScore: 0.5,
              adSaturationScore: null,
              agentVisibilityScore: 0.8,
              sourceDiversity: 0.4,
              verdict: 'test',
              confidence: 'medium',
              evidenceJson: [],
              freshnessDate: '2026-08-26',
              notes: null,
              createdAt: 1,
            },
          ],
        }),
      }),
      env(database)
    );
    expect(response.status).toBe(200);
    expect(database.batch).toHaveBeenCalledTimes(1);
    expect(database.statements).toHaveLength(2);
    expect(database.statements[1]?.sql).toContain('ON CONFLICT(niche_id, snapshot_date)');
  });

  it('replaces one agent-visibility run in the same batch as its entries', async () => {
    const database = mockDb();
    const response = await fetcher.fetch(
      new Request('http://t/admin/scheduled-data/d2c-agent-visibility', {
        method: 'POST',
        headers: authorizedHeaders,
        body: JSON.stringify({
          niches: [],
          runDate: 123,
          entries: [
            {
              id: 'a1',
              nicheId: 'n1',
              platform: 'free-ai',
              model: 'test',
              promptText: 'prompt',
              responseText: 'response',
              recommendedBrands: [],
              citedUrls: [],
              brandMentioned: false,
              gapScore: 1,
              runDate: 123,
              createdAt: 123,
            },
          ],
        }),
      }),
      env(database)
    );
    expect(response.status).toBe(200);
    expect(database.batch).toHaveBeenCalledTimes(1);
    expect(database.statements).toHaveLength(2);
    expect(database.statements[0]?.sql).toContain('DELETE FROM d2c_agent_visibility');
  });
});
