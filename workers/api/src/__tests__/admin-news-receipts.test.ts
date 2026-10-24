import { describe, expect, it } from 'vitest';
import { adminRoute } from '../routes/admin';
import { applyMigrations, createSqliteD1 } from '../../test/sqlite-d1';

const eventRawHash = 'event-original-hash';
const eventId = '145975873c4ff287';

describe('metadata-only public news receipt recovery', () => {
  it('requires admin auth and exposes only eligible metadata-only news preimages', async () => {
    const database = createSqliteD1();
    try {
      applyMigrations(database);
      database.exec(`
        INSERT INTO source_documents
          (id,source,canonical_url,document_key,fetched_at,published_at,raw_hash,raw_text,raw_json,parsed_fields,created_at)
        VALUES ('doc-1','news:datacenterdynamics','https://publisher.example/story','news:datacenterdynamics:https://publisher.example/story',1792638003,1792589160,'old-doc-hash',NULL,NULL,'{"receiptKind":"metadata_only"}',1792638003);
        INSERT INTO events
          (id,source,source_url,published_at,title,content,primary_entity_id,raw_hash,source_document_id,fetch_run_id,ingested_at)
        VALUES ('${eventId}','news:datacenterdynamics','https://publisher.example/story',1792589160,'Amazon withdraws its data center application',NULL,NULL,'${eventRawHash}','doc-1','fetch-run-original',1792638003);
      `);
      const unauth = await adminRoute.request(
        `/news-receipts/${eventId}`,
        {},
        { DB: database.binding, ADMIN_TOKEN: 'test' }
      );
      expect(unauth.status).toBe(401);
      const response = await adminRoute.request(
        `/news-receipts/${eventId}`,
        { headers: { Authorization: 'Bearer test' } },
        { DB: database.binding, ADMIN_TOKEN: 'test' }
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        state: {
          event: { rawHash: string; content: string | null };
          document: { rawHash: string; parsedFields: string; rawText: string | null };
        };
      };
      expect(body.state.event.rawHash).toBe(eventRawHash);
      expect(body.state.event.content).toBeNull();
      expect(body.state.document.rawHash).toBe('old-doc-hash');
      expect(body.state.document.parsedFields).toBe('{"receiptKind":"metadata_only"}');
      expect(body.state.document.rawText).toBeNull();

      const malformed = await adminRoute.request(
        `/news-receipts/${eventId}/apply`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
          body: JSON.stringify({ before: { event: null, document: null } }),
        },
        { DB: database.binding, ADMIN_TOKEN: 'test' }
      );
      expect(malformed.status).toBe(400);
    } finally {
      database.close();
    }
  });

  it('applies and rolls back a receipt with exact event and document compare-and-swap', async () => {
    const database = createSqliteD1();
    try {
      applyMigrations(database);
      database.exec(`
        INSERT INTO source_documents
          (id,source,canonical_url,document_key,fetched_at,published_at,raw_hash,raw_text,raw_json,parsed_fields,created_at)
        VALUES ('doc-1','news:datacenterdynamics','https://publisher.example/story','news:datacenterdynamics:https://publisher.example/story',1792638003,1792589160,'old-doc-hash',NULL,NULL,'{"receiptKind":"metadata_only"}',1792638003);
        INSERT INTO events
          (id,source,source_url,published_at,title,content,primary_entity_id,raw_hash,source_document_id,fetch_run_id,ingested_at)
        VALUES ('${eventId}','news:datacenterdynamics','https://publisher.example/story',1792589160,'Amazon withdraws its data center application',NULL,NULL,'${eventRawHash}','doc-1','fetch-run-original',1792638003);
      `);
      const request = (path: string, body?: unknown) =>
        adminRoute.request(
          path,
          {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          { DB: database.binding, ADMIN_TOKEN: 'test' }
        );
      const initialResponse = await request(`/news-receipts/${eventId}`);
      const initial = (await initialResponse.json()) as {
        state: { event: Record<string, unknown>; document: Record<string, unknown> };
        fingerprint: string;
      };
      const article =
        'Amazon withdrew its application for the Virginia data center campus after public opposition. '.repeat(
          8
        );
      const rawHash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(article)))
      )
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const fetchedAt = Math.floor(Date.now() / 1000);
      const rawJson = JSON.stringify({
        receiptRecovery: {
          originalDocument: initial.state.document,
          retrievedUrl: 'https://publisher.example/story',
          bodyHash: rawHash,
          bodyChars: article.length,
        },
      });
      const parsedFields = JSON.stringify({
        documentKind: 'news_article',
        retrievedFrom: 'public_article_page',
        receiptRecoveryEventId: eventId,
        retrievedUrl: 'https://publisher.example/story',
      });
      await database.binding
        .prepare('UPDATE source_documents SET parsed_fields=? WHERE id=?')
        .bind('{"raced":true}', 'doc-1')
        .run();
      const staleApply = await request(`/news-receipts/${eventId}/apply`, {
        before: initial.state,
        fingerprint: initial.fingerprint,
        fetchedAt,
        rawHash,
        rawText: article,
        rawJson,
        parsedFields,
      });
      expect(staleApply.status).toBe(409);
      const racedPreimage = await database.binding
        .prepare('SELECT parsed_fields FROM source_documents WHERE id=?')
        .bind('doc-1')
        .first<{ parsed_fields: string }>();
      expect(racedPreimage?.parsed_fields).toBe('{"raced":true}');
      await database.binding
        .prepare('UPDATE source_documents SET parsed_fields=? WHERE id=?')
        .bind(initial.state.document['parsedFields'], 'doc-1')
        .run();
      const appliedResponse = await request(`/news-receipts/${eventId}/apply`, {
        before: initial.state,
        fingerprint: initial.fingerprint,
        fetchedAt,
        rawHash,
        rawText: article,
        rawJson,
        parsedFields,
      });
      expect(appliedResponse.status).toBe(200);
      const applied = (await appliedResponse.json()) as {
        fingerprint: string;
        receipt: { bodyHash: string; bodyChars: number };
      };
      expect(applied.receipt).toEqual({ bodyHash: rawHash, bodyChars: article.length });
      expect(JSON.stringify(applied)).not.toContain(article);
      const appliedReadback = await request(`/news-receipts/${eventId}`);
      const appliedReadbackBody = await appliedReadback.json();
      expect(appliedReadback.status).toBe(200);
      expect(JSON.stringify(appliedReadbackBody)).not.toContain(article);
      expect(appliedReadbackBody).toMatchObject({
        receipt: { bodyHash: rawHash, bodyChars: article.length, applied: true },
      });
      const unchanged = await database.binding
        .prepare(
          'SELECT raw_hash,source_document_id,content,source_url,published_at,title,fetch_run_id FROM events WHERE id=?'
        )
        .bind(eventId)
        .first<Record<string, unknown>>();
      expect(unchanged).toEqual({
        raw_hash: eventRawHash,
        source_document_id: 'doc-1',
        content: null,
        source_url: 'https://publisher.example/story',
        published_at: 1792589160,
        title: 'Amazon withdraws its data center application',
        fetch_run_id: 'fetch-run-original',
      });

      const foreignFields = JSON.stringify({
        documentKind: 'news_article',
        retrievedFrom: 'public_article_page',
        receiptRecoveryEventId: eventId,
        retrievedUrl: 'https://foreign.example/copied-story',
      });
      const foreignRawJson = JSON.stringify({
        receiptRecovery: {
          originalDocument: initial.state.document,
          retrievedUrl: 'https://foreign.example/copied-story',
          bodyHash: rawHash,
          bodyChars: article.length,
        },
      });
      const foreignPublisher = await request(`/news-receipts/${eventId}/apply`, {
        before: initial.state,
        fingerprint: initial.fingerprint,
        fetchedAt,
        rawHash,
        rawText: article,
        rawJson: foreignRawJson,
        parsedFields: foreignFields,
      });
      expect(foreignPublisher.status).toBe(400);

      const racedResponse = await request(`/news-receipts/${eventId}/rollback`, {
        before: initial.state,
        afterFingerprint: '0'.repeat(64),
      });
      expect(racedResponse.status).toBe(409);
      const forgedBefore = structuredClone(initial.state);
      forgedBefore.document['rawHash'] = 'forged-original-hash';
      const forgedRollback = await request(`/news-receipts/${eventId}/rollback`, {
        before: forgedBefore,
        afterFingerprint: applied.fingerprint,
      });
      expect(forgedRollback.status).toBe(409);
      await database.binding
        .prepare('UPDATE source_documents SET parsed_fields=? WHERE id=?')
        .bind('{"postApplyConcurrentChange":true}', 'doc-1')
        .run();
      const concurrentRollback = await request(`/news-receipts/${eventId}/rollback`, {
        before: initial.state,
        afterFingerprint: applied.fingerprint,
      });
      expect(concurrentRollback.status).toBe(409);
      await database.binding
        .prepare('UPDATE source_documents SET parsed_fields=? WHERE id=?')
        .bind(parsedFields, 'doc-1')
        .run();
      const rollbackResponse = await request(`/news-receipts/${eventId}/rollback`, {
        before: initial.state,
        afterFingerprint: applied.fingerprint,
      });
      expect(rollbackResponse.status).toBe(200);
      const restored = await database.binding
        .prepare(
          'SELECT fetched_at,raw_hash,raw_text,raw_json,parsed_fields FROM source_documents WHERE id=?'
        )
        .bind('doc-1')
        .first<Record<string, unknown>>();
      expect(restored).toEqual({
        fetched_at: initial.state.document['fetchedAt'],
        raw_hash: initial.state.document['rawHash'],
        raw_text: null,
        raw_json: null,
        parsed_fields: initial.state.document['parsedFields'],
      });
    } finally {
      database.close();
    }
  });
});
