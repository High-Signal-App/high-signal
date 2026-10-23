import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { addFeedSourceResponseSchema, feedSourcesResponseSchema } from '@high-signal/shared';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { adminRoute } from '../routes/admin';
import { feedTransport } from '../../test/feed-fixtures';

let database: TestD1;
const app = new Hono().route('/admin', adminRoute);
const headers = { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' };

function request(path: string, method = 'GET', body?: unknown) {
  return app.request(
    `/admin/feed-sources${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    {
      DB: database.binding,
      ADMIN_TOKEN: 'test-admin',
    }
  );
}

beforeEach(() => {
  database = createSqliteD1();
  applyMigrations(database);
  vi.stubGlobal('fetch', vi.fn(feedTransport()));
});
afterEach(() => {
  database.close();
  vi.unstubAllGlobals();
});

describe('operator publication feed registry', () => {
  it('requires existing operator auth before any discovery or writes', async () => {
    expect(
      (
        await app.request(
          '/admin/feed-sources',
          {},
          { DB: database.binding, ADMIN_TOKEN: 'test-admin' }
        )
      ).status
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect((await request('')).headers.get('cache-control')).toBe('private, no-store');
  });

  it('saves validated URLs once, preserves pause state, and exposes no reader ownership', async () => {
    const added = await request('', 'POST', { url: 'https://publisher.example.org/feed' });
    expect(added.status).toBe(201);
    const first = addFeedSourceResponseSchema.parse(await added.json());
    expect(first.source).toMatchObject({
      title: 'Research & engineering',
      enabled: true,
      lastFetchedAt: null,
      lastFetchCount: null,
    });
    expect((await request(`/${first.source.id}`, 'PATCH', { enabled: false })).status).toBe(200);
    const duplicate = await request('', 'POST', {
      url: 'https://www.publisher.example.org/feed/?utm_source=mail',
    });
    expect(duplicate.status).toBe(200);
    expect(addFeedSourceResponseSchema.parse(await duplicate.json())).toMatchObject({
      created: false,
      source: { id: first.source.id, enabled: false },
    });
    const list = feedSourcesResponseSchema.parse(await (await request('')).json());
    expect(list.sources).toHaveLength(1);
    expect(list.sources[0]).not.toHaveProperty('ownerId');
    expect((await request(`/${first.source.id}`, 'PATCH', { enabled: true })).status).toBe(200);
  });

  it('records successful and failed fetches without stale retries overwriting newer results', async () => {
    const added = addFeedSourceResponseSchema.parse(
      await (await request('', 'POST', { url: 'https://publisher.example.org/feed' })).json()
    );
    const now = Math.floor(Date.now() / 1000);
    const result = {
      sourceKey: 'news:existing-seed',
      fetchedAt: now,
      count: 2,
      error: null,
      lastPublishedAt: now - 100,
    };
    expect((await request(`/${added.source.id}/fetch-result`, 'POST', result)).status).toBe(200);
    expect(
      await (
        await request(`/${added.source.id}/fetch-result`, 'POST', {
          ...result,
          fetchedAt: now - 10,
          count: 99,
          error: 'Old failure',
        })
      ).json()
    ).toEqual({ ok: true, applied: false });
    let list = feedSourcesResponseSchema.parse(await (await request('')).json());
    expect(list.sources[0]).toMatchObject({
      sourceKey: 'news:existing-seed',
      lastFetchCount: 2,
      lastFetchError: null,
    });
    await request(`/${added.source.id}/fetch-result`, 'POST', {
      ...result,
      fetchedAt: now + 1,
      count: 0,
      error: 'Publisher returned HTTP 403',
    });
    list = feedSourcesResponseSchema.parse(await (await request('')).json());
    expect(list.sources[0]?.lastFetchError).toBe('Publisher returned HTTP 403');
  });

  it('does not persist unsafe URLs or malformed updates', async () => {
    expect((await request('', 'POST', { url: 'http://169.254.169.254/' })).status).toBe(400);
    expect(
      (await request('', 'POST', { url: 'https://publisher.example.org/feed?token=secret' })).status
    ).toBe(400);
    expect(feedSourcesResponseSchema.parse(await (await request('')).json()).sources).toEqual([]);
    expect((await request('/missing', 'PATCH', { enabled: true, ownerId: 'reader' })).status).toBe(
      400
    );
  });
});
