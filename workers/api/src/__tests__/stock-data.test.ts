import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { env } from 'node:process';
import { Hono } from 'hono';
import { beforeAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { adminRoute } from '../routes/admin';
import { stockDataRoute } from '../routes/stock-data';
import { contentId, type StockRecord } from '../lib/stock-data-contract';
import type { StockDataset } from '../../../../packages/shared/src/stock-data/public';

const app = new Hono().route('/admin', adminRoute).route('/v1/stock-data', stockDataRoute);
let database: TestD1;
let fixture: {
  records: StockRecord[];
  publication: { display: StockDataset; export: StockDataset };
};
const headers = { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' };

beforeAll(() => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url).href);
  fixture = JSON.parse(
    execFileSync(
      'uv',
      [
        'run',
        '--no-project',
        '--python',
        '3.11',
        '--with',
        'httpx',
        '--with',
        'pydantic',
        'python',
        'python/ingest/tests/stock_data_api_fixture.py',
      ],
      {
        cwd: root,
        env: { ...env, PYTHONPATH: `${root}/python/ingest/src` },
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 4_000_000,
      }
    )
  );
});
beforeEach(() => {
  database = createSqliteD1();
  applyMigrations(database);
});
afterEach(() => database.close());

function request(path: string, body?: unknown, authenticated = true) {
  return app.request(
    path,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: authenticated ? headers : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { DB: database.binding, ADMIN_TOKEN: 'test-admin' }
  );
}

async function retain() {
  const response = await request('/admin/stock-data/records', { records: fixture.records });
  expect(response.status).toBe(200);
  expect(((await response.json()) as { accepted: string[] }).accepted).toEqual(
    fixture.records.map((row) => row.id)
  );
}

describe('private canonical ledger and public stock contracts', () => {
  it('requires existing operator auth for all raw evidence and publication writes', async () => {
    expect((await request('/admin/stock-data/records', undefined, false)).status).toBe(401);
    expect(
      (await request('/admin/stock-data/records', { records: fixture.records }, false)).status
    ).toBe(401);
    expect(
      (await request('/admin/stock-data/publications', fixture.publication, false)).status
    ).toBe(401);
    expect((await request('/v1/stock-data')).status).toBe(503);
  });

  it('retains actual Python records, publishes reproducible ratios and withholds exports', async () => {
    await retain();
    expect((await request('/admin/stock-data/publications', fixture.publication)).status).toBe(200);
    const response = await request('/v1/stock-data');
    const data = (await response.json()) as StockDataset;
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(data.publication_id).toBe(fixture.publication.display.publication_id);
    expect(data.valuations[0]).toMatchObject({
      listed_investment_coverage: '2',
      discount_to_nav: null,
      ranking_eligible: false,
    });
    expect(data.facts).toHaveLength(3);
    const scoped = (await (await request('/v1/stock-data?entity=parent')).json()) as StockDataset;
    expect(scoped.facts.some((fact: { entity_id: string }) => fact.entity_id === 'asset')).toBe(
      true
    );
    expect(data.evidence[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain('base64');
    expect(
      ((await (await request('/v1/stock-data?export=1')).json()) as StockDataset).facts
    ).toEqual([]);
    expect((await request('/v1/stock-data?snapshot=unknown')).status).toBe(409);
    expect((await request('/v1/stock-data', { action: 'write' })).status).toBe(404);
  });

  it('restores raw chunks only through the private bounded cursor and is idempotent', async () => {
    await retain();
    await retain();
    let cursor = 0;
    const records: StockRecord[] = [];
    for (let page = 0; page < 10; page += 1) {
      const response = await request(`/admin/stock-data/records?after=${cursor}`);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const data = (await response.json()) as { records: StockRecord[]; cursor: number };
      if (!data.records.length) break;
      expect(data.cursor).toBeGreaterThan(cursor);
      cursor = data.cursor;
      records.push(...data.records);
    }
    expect(new Set(records.map((row) => row.id))).toEqual(
      new Set(fixture.records.map((row) => row.id))
    );
    expect(records.some((row) => row.kind === 'blob')).toBe(true);
    expect(() => database.exec('DELETE FROM stock_data_records')).toThrow('append-only');
  });

  it('rejects altered identities and publication before retained inputs exist', async () => {
    expect((await request('/admin/stock-data/publications', fixture.publication)).status).toBe(409);
    const changed = structuredClone(fixture.records[0]);
    changed.payload['name'] = 'altered';
    expect((await request('/admin/stock-data/records', { records: [changed] })).status).toBe(400);
    await retain();
    const unlicensed = structuredClone(fixture.publication);
    unlicensed.display.usage_rights[0].public_display = 'unknown';
    expect((await request('/admin/stock-data/publications', unlicensed)).status).toBe(400);
    const forged = structuredClone(fixture.publication);
    forged.display.facts[0].value = '999';
    const { publication_id: _id, ...forgedPayload } = forged.display;
    forged.display.publication_id = await contentId('publication', forgedPayload);
    expect((await request('/admin/stock-data/publications', forged)).status).toBe(400);
    expect(
      (await request('/admin/stock-data/records', { padding: 'x'.repeat(1_600_000) })).status
    ).toBe(413);
  });

  it('revokes public access immediately even before a replacement snapshot is published', async () => {
    await retain();
    expect((await request('/admin/stock-data/publications', fixture.publication)).status).toBe(200);
    const rights = structuredClone(fixture.records.find((row) => row.kind === 'rights')!);
    rights.payload['public_display'] = 'prohibited';
    rights.id = await contentId('rights', rights.payload);
    expect((await request('/admin/stock-data/records', { records: [rights] })).status).toBe(200);
    expect((await request('/v1/stock-data')).status).toBe(503);
    expect((await request('/admin/stock-data/publications', fixture.publication)).status).toBe(409);
  });
});
