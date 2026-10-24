import { describe, expect, it } from 'vitest';
import {
  adminRoute,
  canonicalSourceUrl,
  normalizeSourceDocument,
  sourceDocumentKey,
} from '../routes/admin';
import { retainedEvidenceCandidates } from '../lib/attention-admin';
import { applyMigrations, createSqliteD1 } from '../../test/sqlite-d1';

describe('source document normalization', () => {
  it('canonicalizes tracking params and fragments', () => {
    expect(canonicalSourceUrl('https://www.example.com/a/?utm_source=x&ref=y&keep=1#section')).toBe(
      'https://example.com/a/?keep=1'
    );
  });

  it('uses source and canonical URL as stable document identity', () => {
    const first = normalizeSourceDocument({
      source: 'news:example',
      sourceUrl: 'https://www.example.com/a?utm_source=x#one',
      publishedAt: '2026-06-01T00:00:00.000Z',
      rawHash: 'event-hash-one',
    });
    const second = normalizeSourceDocument({
      source: 'news:example',
      sourceUrl: 'https://example.com/a',
      publishedAt: '2026-06-01T00:00:00.000Z',
      rawHash: 'event-hash-two',
    });

    expect(first.documentKey).toBe(second.documentKey);
    expect(first.rawHash).not.toBe(second.rawHash);
  });

  it('allows explicit producers to provide document keys', () => {
    const doc = normalizeSourceDocument({
      source: 'research-paper',
      sourceUrl: 'https://example.com/paper',
      publishedAt: '2026-06-01T00:00:00.000Z',
      rawHash: 'event',
      sourceDocument: {
        documentKey: 'paper:doi:10.0000/example',
        canonicalUrl: 'https://example.com/paper',
        rawHash: 'paper-version',
      },
    });

    expect(doc.documentKey).toBe('paper:doi:10.0000/example');
    expect(sourceDocumentKey('research-paper', doc.canonicalUrl)).toBe(
      'research-paper:https://example.com/paper'
    );
  });
});

describe('retained article receipt repair through actual SQLite upserts', () => {
  it.each([null, 'AI - unrelated navigation text retained by an older extraction'])(
    'repairs an existing receipt while preserving its original event observation: %s',
    async (initialText) => {
      const database = createSqliteD1();
      try {
        applyMigrations(database);
        const now = new Date();
        const fetchedAt = new Date(now.getTime() - 60_000);
        const source = 'news:refresh-example';
        const url = 'https://publisher.example/earnings?utm_source=feed';
        const title = 'Acme reports fiscal earnings and manufacturing output';
        const text =
          'Acme reported manufacturing output and fiscal earnings with the underlying operational details. '.repeat(
            12
          );
        const event = {
          source,
          sourceUrl: url,
          title,
          publishedAt: now.toISOString(),
          rawHash: 'unchanged-event-identity',
          content: initialText,
        };
        async function push(sourceDocument?: Record<string, unknown>) {
          const response = await adminRoute.request(
            '/events',
            {
              method: 'POST',
              headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                events: [
                  { ...event, ...(sourceDocument ? { content: text, sourceDocument } : {}) },
                ],
              }),
            },
            { DB: database.binding, ADMIN_TOKEN: 'test' }
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ inserted: 1 });
        }
        await push();
        const original = await database.binding
          .prepare('SELECT id,source_document_id FROM events')
          .first<{ id: string; source_document_id: string }>();
        await push({
          canonicalUrl: url,
          fetchedAt: fetchedAt.toISOString(),
          publishedAt: now.toISOString(),
          rawHash: 'repaired-article-hash',
          rawText: text,
          parsedFields: { documentKind: 'news_article', retrievedFrom: 'public_article_page' },
        });
        // A failed subsequent collection is implicit, so it cannot clear a
        // substantive explicit retained article that was acknowledged before it.
        await push();
        const events = await database.binding
          .prepare('SELECT id,source_document_id,content FROM events')
          .all<{ id: string; source_document_id: string; content: string | null }>();
        expect(events.results).toEqual([{ ...original, content: initialText }]);
        const receipt = await database.binding
          .prepare('SELECT id,document_key,raw_text,raw_hash,fetched_at FROM source_documents')
          .first<{
            id: string;
            document_key: string;
            raw_text: string;
            raw_hash: string;
            fetched_at: number;
          }>();
        expect(receipt?.id).toBe(original?.source_document_id);
        expect(receipt?.document_key).toBe(
          'news:refresh-example:https://publisher.example/earnings'
        );
        expect(receipt?.raw_text).toBe(text);
        expect(receipt?.raw_hash).toBe('repaired-article-hash');
        expect(receipt?.fetched_at).toBe(Math.floor(fetchedAt.getTime() / 1000));
        const candidates = await retainedEvidenceCandidates(
          database.binding,
          title,
          Math.floor(now.getTime() / 1000),
          ['reddit:%']
        );
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({ url, retainedContent: text, retainedSource: source });
      } finally {
        database.close();
      }
    }
  );

  it('falls back to event content when a legacy retained body is empty', async () => {
    const database = createSqliteD1();
    try {
      applyMigrations(database);
      const now = Math.floor(Date.now() / 1000);
      const text =
        'Acme reported an operational manufacturing milestone with clear fiscal results. '.repeat(
          12
        );
      await database.binding
        .prepare(`INSERT INTO source_documents
        (id,source,canonical_url,document_key,fetched_at,published_at,raw_hash,raw_text,created_at)
        VALUES('empty-doc','news:legacy','https://publisher.example/legacy','legacy',?,?,'doc-hash','',?)`)
        .bind(now, now - 60, now)
        .run();
      await database.binding
        .prepare(`INSERT INTO events
        (id,source,source_url,published_at,title,content,raw_hash,source_document_id,ingested_at)
        VALUES('legacy','news:legacy','https://publisher.example/legacy',?,'Acme manufacturing fiscal results',?,'event-hash','empty-doc',?)`)
        .bind(now - 60, text, now)
        .run();
      const rows = await retainedEvidenceCandidates(
        database.binding,
        'Acme manufacturing fiscal results',
        now,
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].retainedContent).toBe(text);
    } finally {
      database.close();
    }
  });
});
