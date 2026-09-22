import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { app } from '../app';

const NOW = Math.floor(Date.now() / 1000);

let d1: TestD1;
const env = () => ({ DB: d1.binding, ENVIRONMENT: 'test' });

beforeEach(() => {
  d1 = createSqliteD1();
  applyMigrations(d1);
  d1.exec(
    `INSERT INTO entities (id, ticker, name, type, created_at, updated_at)
     VALUES ('ent-tsla', 'TSLA', 'Tesla', 'public', ${NOW}, ${NOW})`
  );
  d1.exec(
    `INSERT INTO source_documents (id, source, canonical_url, document_key, fetched_at, published_at, raw_hash, raw_text, created_at)
     VALUES ('doc-1', 'news:example', 'https://example.test/story', 'news:example:https://example.test/story', ${NOW}, ${NOW}, 'dh-1', 'Retained article body about the launch.', ${NOW})`
  );
  d1.exec(
    `INSERT INTO events (id, source, source_url, published_at, title, content, primary_entity_id, raw_hash, ingested_at, source_document_id)
     VALUES
       ('ev-1', 'news:example', 'https://example.test/story', ${NOW}, 'Example story', 'short extract', 'ent-tsla', 'h-1', ${NOW}, 'doc-1'),
       ('ev-bare', 'ir', 'https://ir.example.test/page', ${NOW - 3600}, 'Bare IR snapshot', NULL, NULL, 'h-2', ${NOW - 3600}, NULL)`
  );
});

afterEach(() => {
  d1.close();
});

async function get(path: string) {
  const response = await app.fetch(new Request(`http://test${path}`), env());
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /data/records/:id', () => {
  it('returns one retained record with its document text and resolved entity', async () => {
    const { status, body } = await get('/data/records/ev-1');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: 'ev-1',
      source: 'news:example',
      family: 'news',
      url: 'https://example.test/story',
      canonicalUrl: 'https://example.test/story',
      title: 'Example story',
      content: 'short extract',
      retainedText: 'Retained article body about the launch.',
      retainedTextTruncated: false,
      entity: 'ent-tsla',
      entityName: 'Tesla',
      publishedAt: NOW,
      ingestedAt: NOW,
      documentFetchedAt: NOW,
      available: true,
    });
  });

  it('returns a metadata-only record when no document body was retained', async () => {
    const { status, body } = await get('/data/records/ev-bare');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: 'ev-bare',
      source: 'ir',
      family: 'ir',
      retainedText: null,
      entity: null,
      entityName: null,
      available: true,
    });
  });

  it('404s an unknown id rather than fabricating a record', async () => {
    const { status, body } = await get('/data/records/no-such-record');
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
  });
});
