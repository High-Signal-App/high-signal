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
});
