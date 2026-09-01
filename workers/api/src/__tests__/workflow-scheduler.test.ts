import { describe, expect, it, vi } from 'vitest';
import { dispatchDueWorkflows, workflowsDueAt } from '../lib/workflow-scheduler';

function mockDb(options: { duplicate?: boolean } = {}) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  return {
    statements,
    prepare: vi.fn((sql: string) => {
      let values: unknown[] = [];
      return {
        bind: vi.fn((...incoming: unknown[]) => {
          values = incoming;
          statements.push({ sql, values });
          return {
            run: vi.fn(async () => ({
              meta: {
                changes:
                  sql.includes('INSERT INTO workflow_dispatches') && !options.duplicate ? 1 : 0,
              },
            })),
          };
        }),
      };
    }),
  };
}

describe('Cloudflare workflow scheduler', () => {
  it('maps exact archive and half-hour slots to their daily stages', () => {
    expect(workflowsDueAt(new Date('2026-08-29T00:17:00Z'))).toEqual([
      {
        workflow: 'cron-reddit-archive.yml',
        purpose: 'reddit-archive',
        inputs: {
          cohort: 'all',
          runner: 'github-hosted',
          window_end: '2026-08-29T00:17:00.000Z',
        },
      },
    ]);
    expect(workflowsDueAt(new Date('2026-08-29T02:30:00Z'))).toEqual([
      { workflow: 'cron-digg.yml', purpose: 'digg' },
      { workflow: 'cron-mts.yml', purpose: 'mts' },
      { workflow: 'cron-ingest.yml', purpose: 'ingest' },
    ]);
    expect(workflowsDueAt(new Date('2026-08-29T03:30:00Z'))[2]).toEqual({
      workflow: 'cron-publish.yml',
      purpose: 'publish',
    });
    expect(workflowsDueAt(new Date('2026-08-29T04:00:00Z'))[2]).toEqual({
      workflow: 'cron-validate-brief.yml',
      purpose: 'validate',
    });
    expect(workflowsDueAt(new Date('2026-08-29T04:30:00Z'))[2]).toEqual({
      workflow: 'personal-brief.yml',
      purpose: 'deliver',
    });
    expect(workflowsDueAt(new Date('2026-08-29T04:17:00Z'))).toEqual([]);
  });

  it('dispatches the canonical archive with its exact window boundary', async () => {
    const db = mockDb();
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    const results = await dispatchDueWorkflows(
      { DB: db as unknown as D1Database, GITHUB_WORKFLOW_TOKEN: 'test-token' },
      new Date('2026-08-29T00:17:00Z'),
      { fetch: fetcher, attemptedAt: new Date('2026-08-29T00:17:01Z') }
    );

    expect(results).toMatchObject([
      { workflow: 'cron-reddit-archive.yml', purpose: 'reddit-archive', status: 'dispatched' },
    ]);
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toContain('/workflows/cron-reddit-archive.yml/dispatches');
    expect(calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          cohort: 'all',
          runner: 'github-hosted',
          window_end: '2026-08-29T00:17:00.000Z',
        },
      }),
    });
  });

  it('fails closed without reading D1 when the token is absent', async () => {
    const db = mockDb();

    const results = await dispatchDueWorkflows(
      { DB: db as unknown as D1Database, GITHUB_WORKFLOW_TOKEN: undefined },
      new Date('2026-08-29T02:30:00Z')
    );

    expect(results.map((result) => result.status)).toEqual(['disabled', 'disabled', 'disabled']);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('claims each slot once and dispatches the matching workflow on main', async () => {
    const db = mockDb();
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    const results = await dispatchDueWorkflows(
      { DB: db as unknown as D1Database, GITHUB_WORKFLOW_TOKEN: 'test-token' },
      new Date('2026-08-29T02:30:00Z'),
      { fetch: fetcher, attemptedAt: new Date('2026-08-29T02:30:01Z') }
    );

    expect(results.map((result) => result.status)).toEqual([
      'dispatched',
      'dispatched',
      'dispatched',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[1]?.[0]).toContain('/workflows/cron-mts.yml/dispatches');
    expect(calls[2]?.[0]).toContain('/workflows/cron-ingest.yml/dispatches');
    expect(calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ ref: 'main' }),
    });
    expect(db.statements.filter((statement) => statement.sql.startsWith('UPDATE'))).toHaveLength(3);
  });

  it('does not call GitHub when the D1 slot lease already exists', async () => {
    const db = mockDb({ duplicate: true });
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    const results = await dispatchDueWorkflows(
      { DB: db as unknown as D1Database, GITHUB_WORKFLOW_TOKEN: 'test-token' },
      new Date('2026-08-29T13:00:00Z'),
      { fetch: fetcher }
    );

    expect(results).toMatchObject([
      { workflow: 'cron-digg.yml', status: 'duplicate' },
      { workflow: 'cron-mts.yml', status: 'duplicate' },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('records a failed dispatch without logging or persisting the token', async () => {
    const db = mockDb();
    const fetcher = vi.fn(async () => new Response('forbidden', { status: 403 }));

    const results = await dispatchDueWorkflows(
      { DB: db as unknown as D1Database, GITHUB_WORKFLOW_TOKEN: 'test-token' },
      new Date('2026-08-29T13:30:00Z'),
      { fetch: fetcher }
    );

    expect(results).toMatchObject([
      { status: 'failed', statusCode: 403 },
      { status: 'failed', statusCode: 403 },
    ]);
    expect(db.statements.at(-1)?.values).toContain('github_dispatch_403');
    expect(JSON.stringify(db.statements)).not.toContain('test-token');
  });
});
