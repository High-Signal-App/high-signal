import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { addFeedSourceResponseSchema, feedSourcesResponseSchema } from '@high-signal/shared';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { adminRoute } from '../routes/admin';
import { FEED_SOURCE_MIGRATION } from '../lib/feed-source-migration';
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

function legacyMigrationState() {
  database.exec(`DROP TABLE feed_sources;
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    INSERT INTO d1_migrations (name) VALUES ('0029_source_document_hash_index_repair.sql');`);
}
const initialization = { migration: '0030_feed_sources.sql' };

async function registryExists() {
  return database.binding
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feed_sources'")
    .first();
}

describe('bounded feed registry release migration', () => {
  it('matches the canonical migration SQL', () => {
    const canonical = readFileSync(
      fileURLToPath(
        new URL('../../../../packages/db/migrations/0030_feed_sources.sql', import.meta.url).href
      ),
      'utf8'
    );
    expect(FEED_SOURCE_MIGRATION.sql.trim()).toBe(canonical.trim());
  });

  it('requires operator auth and accepts only the one named migration', async () => {
    legacyMigrationState();
    expect(
      (
        await app.request(
          '/admin/feed-sources/initialize',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initialization),
          },
          { DB: database.binding, ADMIN_TOKEN: 'test-admin' }
        )
      ).status
    ).toBe(401);
    expect(
      (await request('/initialize', 'POST', { migration: '0020_remove_reader_accounts.sql' }))
        .status
    ).toBe(400);
    expect(
      (await request('/initialize', 'POST', { ...initialization, sql: 'DROP TABLE signals' }))
        .status
    ).toBe(400);
    expect(await registryExists()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('initializes a legacy database once and keeps sources and pauses on retry', async () => {
    legacyMigrationState();
    const response = await request('/initialize', 'POST', initialization);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...initialization, applied: true });
    expect(feedSourcesResponseSchema.parse(await (await request('')).json()).sources).toEqual([]);
    const added = addFeedSourceResponseSchema.parse(
      await (await request('', 'POST', { url: 'https://publisher.example.org/feed' })).json()
    );
    await request(`/${added.source.id}`, 'PATCH', { enabled: false });
    expect(await (await request('/initialize', 'POST', initialization)).json()).toEqual({
      ok: true,
      ...initialization,
      applied: false,
    });
    const list = feedSourcesResponseSchema.parse(await (await request('')).json());
    expect(list.sources).toHaveLength(1);
    expect(list.sources[0]).toMatchObject({ id: added.source.id, enabled: false });
    expect(
      await database.binding
        .prepare('SELECT count(*) AS total FROM d1_migrations WHERE name = ?')
        .bind(initialization.migration)
        .first('total')
    ).toBe(1);
  });

  it('does not record a migration over an incompatible existing table', async () => {
    legacyMigrationState();
    database.exec(
      "CREATE TABLE feed_sources (id TEXT); INSERT INTO feed_sources VALUES ('preserved');"
    );
    expect((await request('/initialize', 'POST', initialization)).status).toBe(503);
    expect(
      await database.binding
        .prepare('SELECT name FROM d1_migrations WHERE name = ?')
        .bind(initialization.migration)
        .first()
    ).toBeNull();
    expect(await database.binding.prepare('SELECT id FROM feed_sources').first('id')).toBe(
      'preserved'
    );
  });

  it('fails closed if a recorded registry was removed instead of recreating lost pauses', async () => {
    legacyMigrationState();
    database.exec("INSERT INTO d1_migrations (name) VALUES ('0030_feed_sources.sql');");
    expect((await request('/initialize', 'POST', initialization)).status).toBe(503);
    expect(await registryExists()).toBeNull();
  });
});
